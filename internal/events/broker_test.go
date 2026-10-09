package events

import "testing"

func TestSlowSubscriberDoesNotBlock(t *testing.T) {
	b := New()
	ch, stop := b.Subscribe()
	b.Publish("snapshot")
	b.Publish("changed")
	if <-ch != "snapshot" {
		t.Fatal("first invalidation lost")
	}
	stop()
	b.Publish("changed")
	if len(b.clients) != 0 {
		t.Fatal("subscriber leaked")
	}
}
