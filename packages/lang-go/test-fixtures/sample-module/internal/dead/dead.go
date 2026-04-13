package dead

// TrulyDead is never called from anywhere. It must appear in the dead-code
// output. Compare with reflective.Plugin.* which look dead but must NOT
// appear because they are reachable via reflection.
func TrulyDead() string {
	return "no one calls me"
}

// LiveHelper is called from cmd/app/main.go so it must NOT be in the
// dead-code list — proves cross-package call resolution works.
func LiveHelper() int {
	return 42
}
