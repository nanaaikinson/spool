package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/config"
)

func main() {
	if os.Getenv("REDIS_URL") == "" {
		log.Fatal("set REDIS_URL to a dedicated demo Redis database before running the demo")
	}
	c, e := config.Load()
	if e != nil {
		log.Fatal(e)
	}
	client := asynq.NewClient(c.Redis())
	defer client.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := asynq.NewServer(
		c.Redis(),
		asynq.Config{
			Concurrency: 8,
			Queues:      map[string]int{"critical": 6, "default": 3, "reports": 1},
			RetryDelayFunc: func(n int, e error, t *asynq.Task) time.Duration {
				return time.Duration(n+1) * 30 * time.Second
			},
		},
	)
	mux := asynq.NewServeMux()
	mux.HandleFunc("email:deliver", func(ctx context.Context, t *asynq.Task) error {
		time.Sleep(350 * time.Millisecond)
		_, e := t.ResultWriter().Write([]byte(`{"delivered":true}`))
		return e
	})
	mux.HandleFunc("report:generate", func(ctx context.Context, t *asynq.Task) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Second):
			return nil
		}
	})
	mux.HandleFunc("invoice:sync", func(ctx context.Context, t *asynq.Task) error {
		return errors.New("billing API returned 503: upstream unavailable")
	})
	mux.HandleFunc("webhook:deliver", func(ctx context.Context, t *asynq.Task) error {
		return fmt.Errorf("endpoint returned 429: rate limit exceeded")
	})
	if e := server.Start(mux); e != nil {
		log.Fatal(e)
	}
	defer server.Shutdown()
	scheduler := asynq.NewScheduler(c.Redis(), nil)
	if _, e = scheduler.Register(
		"@every 1m",
		asynq.NewTask("report:generate", []byte(`{"period":"hourly"}`)),
		asynq.Queue("reports"),
		asynq.Retention(24*time.Hour),
	); e != nil {
		log.Fatal(e)
	}
	if e = scheduler.Start(); e != nil {
		log.Fatal(e)
	}
	defer scheduler.Shutdown()
	seed := func() {
		for i := 0; i < 12; i++ {
			kind, q := []string{"email:deliver", "invoice:sync", "webhook:deliver", "report:generate"}[i%4],
				[]string{"default", "critical", "default", "reports"}[i%4]
			payload, _ := json.Marshal(map[string]any{"account_id": fmt.Sprintf("demo-%03d", i), "region": "eu-west-1", "demo": true})
			opts := []asynq.Option{asynq.Queue(q), asynq.MaxRetry(3), asynq.Retention(24 * time.Hour)}
			if i == 11 {
				opts = append(opts, asynq.ProcessIn(10*time.Minute))
			}
			if _, e := client.EnqueueContext(ctx, asynq.NewTask(kind, payload), opts...); e != nil {
				log.Printf("enqueue failed: %v", e)
			}
		}
	}
	seed()
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	log.Println("demo running: enqueuing tasks every 30 seconds; press Ctrl+C to stop")
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			seed()
		}
	}
}
