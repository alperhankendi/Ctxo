package embed

// Base provides shared behavior; ChildJob and Variant both embed it.
// The analyzer must emit `extends` edges from both children to Base.
type Base struct {
	ID string
}

func (b *Base) Identifier() string {
	return b.ID
}

// ChildJob embeds Base by value (promotes Identifier).
type ChildJob struct {
	Base
	Stage string
}

// Variant embeds *Base by pointer.
type Variant struct {
	*Base
	Tag string
}
