package store

// Store is the interface every backend implements.
// Two implementations live in this package; the analyzer must emit
// `implements` edges from both to Store.
type Store interface {
	Get(key string) (string, bool)
	Put(key, value string)
}

// MemoryStore is a value-receiver implementation of Store.
type MemoryStore struct {
	data map[string]string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{data: make(map[string]string)}
}

func (m *MemoryStore) Get(key string) (string, bool) {
	v, ok := m.data[key]
	return v, ok
}

func (m *MemoryStore) Put(key, value string) {
	m.data[key] = value
}

// LoggingStore is a pointer-receiver implementation that wraps another Store.
type LoggingStore struct {
	Inner Store
}

func (l *LoggingStore) Get(key string) (string, bool) {
	return l.Inner.Get(key)
}

func (l *LoggingStore) Put(key, value string) {
	l.Inner.Put(key, value)
}
