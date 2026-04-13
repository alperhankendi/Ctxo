package generic

// List is a generic container used to validate that the analyzer emits
// a single uses-edge to the unconstructed `List` symbol while preserving
// type arguments on edge metadata (ADR-013 §4 Q4 generics decision).
type List[T any] struct {
	items []T
}

func New[T any]() *List[T] {
	return &List[T]{}
}

func (l *List[T]) Add(v T) {
	l.items = append(l.items, v)
}

func (l *List[T]) Len() int {
	return len(l.items)
}
