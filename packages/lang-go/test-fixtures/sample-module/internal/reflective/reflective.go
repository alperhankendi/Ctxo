package reflective

import "reflect"

// Plugin is accessed only through reflection. Its methods would otherwise
// be flagged as dead, but the reflect-safe heuristic must keep them alive.
type Plugin struct {
	Name string
}

func (p Plugin) Run() string {
	return "running " + p.Name
}

func (p Plugin) Validate() bool {
	return p.Name != ""
}

// Inspect uses reflect.TypeOf on Plugin so the analyzer can see the
// reflective access at AST level.
func Inspect() string {
	return reflect.TypeOf(Plugin{}).Name()
}
