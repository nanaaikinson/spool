// Package version reports the Spool release this binary was built from.
package version

// Version is set at build time with
// -ldflags "-X github.com/nanaaikinson/spool/internal/version.Version=1.2.3".
var Version = "dev"
