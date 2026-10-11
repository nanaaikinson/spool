package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/nanaaikinson/spool/internal/store"
)

func main() {
	identity := flag.Bool("identity", false, "reset the isolated browser identity schema")
	flag.Parse()
	if *identity {
		dsn := os.Getenv("SPOOL_TEST_DATABASE")
		if dsn == "" {
			log.Fatal("SPOOL_TEST_DATABASE is required for isolated identity fixtures")
		}
		db, e := store.Open(context.Background(), dsn)
		if e != nil {
			log.Fatal("could not open browser test database")
		}
		defer db.DB.Close()
		if _, e := db.DB.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS spool_e2e_identity CASCADE; CREATE SCHEMA spool_e2e_identity"); e != nil {
			log.Fatal("could not reset browser identity schema")
		}
		return
	}

	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" || !strings.HasSuffix(address, "/15") {
		log.Fatal("SPOOL_TEST_REDIS must select the dedicated test database 15 (for example redis://127.0.0.1:6388/15)")
	}
	opt, e := asynq.ParseRedisURI(address)
	if e != nil {
		log.Fatal(e)
	}
	client := asynq.NewClient(opt)
	defer client.Close()
	inspector := asynq.NewInspector(opt)
	defer inspector.Close()
	q := "spool-e2e"
	if e = inspector.DeleteQueue(q, true); e != nil && e != asynq.ErrQueueNotFound {
		log.Printf("reset queue: %v", e)
	}
	for i := 0; i < 5; i++ {
		t, e := client.EnqueueContext(
			context.Background(),
			asynq.NewTask("fixture:inspect", []byte(`{"account_id":"fixture","amount":1200}`)),
			asynq.Queue(q),
			asynq.TaskID(fmt.Sprintf("fixture-%d", i)),
		)
		if e != nil {
			log.Fatal(e)
		}
		if i == 4 {
			if e = inspector.ArchiveTask(q, t.ID); e != nil {
				log.Fatal(e)
			}
		}
	}
	if _, e = client.Enqueue(
		asynq.NewTask("fixture:scheduled", []byte("plain text")),
		asynq.Queue(q),
		asynq.ProcessIn(time.Hour),
		asynq.TaskID("fixture-scheduled"),
	); e != nil {
		log.Fatal(e)
	}
	fmt.Println("Seeded the spool-e2e queue in Redis database 15.")
}
