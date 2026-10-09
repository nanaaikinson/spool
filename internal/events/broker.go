package events

import (
	"context"
	"sync"
	"time"
)

type Broker struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func New() *Broker {
	return &Broker{clients: map[chan string]struct{}{}}
}

func (b *Broker) Subscribe() (chan string, func()) {
	ch := make(chan string, 1)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.clients, ch)
		b.mu.Unlock()
	}
}

func (b *Broker) Publish(event string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clients {
		select {
		case ch <- event:
		default:
		}
	}
}

func (b *Broker) Run(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			b.Publish("snapshot")
		}
	}
}
