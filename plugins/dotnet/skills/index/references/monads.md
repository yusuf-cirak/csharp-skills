# Monadic error handling — library selection & usage

Shared rule referenced by `csharp` (functional idioms), `ddd` (factory validation returns), and `validation` (VO factories).

- Prefer monadic error handling over exceptions, and monadic optionals over nullable references.
- **Library selection (check before writing):**
  1. If the project references **`YC.Monad`** (check `.csproj`/`Directory.Packages.props`/`global.json`), use `Result<T>` and `Option<T>` from it. This is the default preference.
  2. Otherwise, use whatever the existing codebase already uses — e.g. `OneOf`, `LanguageExt`, `ErrorOr`, `CSharpFunctionalExtensions`, or a hand-rolled `Result`/`Option` type. Match the project's convention; do not introduce a competing library.
  3. Only if no equivalent exists in the codebase, ask the user before adding a new dependency.
- Quick check command: `grep -r "YC.Monad" *.csproj Directory.Packages.props 2>/dev/null` or inspect `using` directives in existing handlers.
- Mix functional and object-oriented patterns where appropriate.
- Follow .NET / ASP.NET Core conventions.
- Prefer composition over inheritance.
