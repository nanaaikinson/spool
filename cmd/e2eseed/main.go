package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/hibiken/asynq"
)

func main() {
	address := os.Getenv("SPOOL_TEST_REDIS")
	if address == "" || !strings.HasSuffix(address, "/15") {
		log.Fatal("SPOOL_TEST_REDIS must explicitly select the dedicated test database /15")
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
	fmt.Println("Seeded isolated spool-e2e queue in Redis database 15")
}
