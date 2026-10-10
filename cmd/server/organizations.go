package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	native "github.com/hibiken/asynq/x/metrics"
	"github.com/nanaaikinson/spool/internal/config"
	"github.com/nanaaikinson/spool/internal/domain"
	"github.com/nanaaikinson/spool/internal/store"
	"github.com/prometheus/client_golang/prometheus"
)

// Describe intentionally emits no descriptors: organizations can be added at runtime.
type organizationCollector struct {
	Store  *store.Store
	Config config.Config
}

func (*organizationCollector) Describe(chan<- *prometheus.Desc) {}
func (c *organizationCollector) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	orgs, e := c.Store.Organizations(ctx, "", true)
	if e != nil {
		return
	}
	for _, org := range orgs {
		if ctx.Err() != nil {
			return
		}
		in, e := c.Store.Connection(ctx, org.ID, c.Config.DataKey)
		if e != nil {
			continue
		}
		cfg := c.Config
		cfg.RedisURL = in.RedisURL
		inspector := asynq.NewInspector(cfg.Redis())
		prometheus.WrapCollectorWith(prometheus.Labels{"organization": org.ID}, native.NewQueueMetricsCollector(inspector)).Collect(ch)
		_ = inspector.Close()
	}
}

// setup reads JSON from stdin so credentials need not appear in shell history or process arguments.
func setupCLI(args []string) error {
	flags := flag.NewFlagSet("setup", flag.ContinueOnError)
	address := flags.String("url", "http://127.0.0.1:8088", "Spool origin (HTTPS, or localhost HTTP)")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: spool setup [--url ORIGIN] < private-setup.json\nJSON: token, username, password, organization: {name, redis_url, prometheus_url}")
		flags.PrintDefaults()
	}
	if e := flags.Parse(args); e != nil {
		if errors.Is(e, flag.ErrHelp) {
			return nil
		}
		return e
	}
	u, e := url.Parse(*address)
	if e != nil || u.User != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return errors.New("use HTTPS or loopback HTTP for --url")
	}
	var in domain.SetupRequest
	d := json.NewDecoder(io.LimitReader(os.Stdin, 512*1024+1))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(&struct{}{}) != io.EOF {
		return errors.New("provide one setup JSON object on stdin")
	}
	raw, _ := json.Marshal(in)
	req, e := http.NewRequest("POST", strings.TrimRight(*address, "/")+"/api/v1/setup", bytes.NewReader(raw))
	if e != nil {
		return errors.New("invalid Spool URL")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Spool-Action", "confirmed")
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Do(req)
	if e != nil {
		return errors.New("could not reach Spool; check the URL and TLS")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		var out domain.Error
		if json.NewDecoder(io.LimitReader(res.Body, 64*1024)).Decode(&out) == nil {
			return fmt.Errorf("setup failed: %s", out.Message)
		}
		return fmt.Errorf("setup failed (HTTP %d)", res.StatusCode)
	}
	var org domain.Organization
	if json.NewDecoder(res.Body).Decode(&org) != nil {
		return errors.New("invalid setup response")
	}
	fmt.Printf("Created organization %s (%s). Sign in to the console.\n", org.Name, org.ID)
	return nil
}

// Recovery needs operator database access, independent of Redis, signing or data keys.
func recoverAdminCLI(args []string) error {
	if len(args) == 0 || args[0] != "recover" {
		return errors.New("usage: spool admin recover --username USER --confirm < private-recovery.json")
	}
	flags := flag.NewFlagSet("admin recover", flag.ContinueOnError)
	username := flags.String("username", "", "Existing deployment administrator username")
	confirmed := flags.Bool("confirm", false, "Confirm password reset, account re-enabling and session revocation")
	if e := flags.Parse(args[1:]); e != nil {
		if errors.Is(e, flag.ErrHelp) {
			return nil
		}
		return e
	}
	if flags.NArg() != 0 || !*confirmed || !store.ValidUsername(*username) {
		return errors.New("provide --username and --confirm; supply the new password as JSON on stdin")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("set DATABASE_URL in the process environment; run recovery inside the app container or through your secret manager")
	}
	var input struct {
		Password string `json:"password"`
	}
	raw, e := io.ReadAll(io.LimitReader(os.Stdin, 1025))
	if e != nil || len(raw) > 1024 {
		return errors.New("recovery input must be at most 1024 bytes")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF {
		return errors.New("provide one JSON object containing password on stdin")
	}
	if len(input.Password) < 12 || len(input.Password) > 72 {
		return errors.New("the new password must be 12–72 bytes")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, e := store.Open(ctx, dsn)
	if e != nil {
		return errors.New("could not connect to PostgreSQL or apply migrations; check DATABASE_URL")
	}
	defer db.DB.Close()
	if e := db.RecoverAdministrator(ctx, *username, input.Password); e != nil {
		if errors.Is(e, store.ErrIdentityNotFound) {
			return errors.New("recovery requires an existing deployment administrator; ordinary accounts cannot be promoted")
		}
		return errors.New("administrator recovery failed; no changes were committed")
	}
	fmt.Printf("Recovered deployment administrator %s. Existing sessions were revoked. Sign in with the new password.\n", *username)
	return nil
}
