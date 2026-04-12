export interface IPackage {
  /** Absolute path to the package root. */
  readonly root: string;
  /** Absolute path to the package manifest (package.json, pyproject.toml, pom.xml, etc.). */
  readonly manifest: string;
  /** Optional human-readable package name. */
  readonly name?: string;
}

/**
 * Workspace abstraction. v0.7 always describes a single-package workspace;
 * future monorepo detectors implement the same interface without breaking callers.
 */
export interface IWorkspace {
  /** Absolute path to the workspace root. */
  readonly root: string;
  /** Packages contained in the workspace. Always length 1 in v0.7. */
  readonly packages: readonly IPackage[];
}
