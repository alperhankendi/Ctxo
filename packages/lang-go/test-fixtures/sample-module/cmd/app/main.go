package main

import (
	"sample/internal/dead"
	"sample/internal/embed"
	"sample/internal/generic"
	"sample/internal/reflective"
	"sample/internal/store"
	"sample/pkg/api"
)

func main() {
	mem := store.NewMemoryStore()
	logged := &store.LoggingStore{Inner: mem}
	svc := api.NewService(logged)
	svc.Lookup("greeting")

	job := embed.ChildJob{Base: embed.Base{ID: "j1"}, Stage: "init"}
	_ = job.Identifier()

	list := generic.New[int]()
	list.Add(1)

	_ = reflective.Inspect()
	_ = dead.LiveHelper()
}
