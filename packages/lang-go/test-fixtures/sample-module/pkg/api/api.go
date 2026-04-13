package api

import "sample/internal/store"

// Service is exported and called from cmd/app to exercise cross-package
// `calls` and `uses` edges.
type Service struct {
	Backend store.Store
}

func NewService(s store.Store) *Service {
	return &Service{Backend: s}
}

func (s *Service) Lookup(key string) string {
	v, _ := s.Backend.Get(key)
	return v
}
