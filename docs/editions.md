# Frontend editions

The public frontend contains the Rush application shell, shared components, API clients, and open-source pages. Kubernetes resource browsing stays public alongside ArgoCD and FluxCD. PostgreSQL, MySQL, and Kubernetes access logging are added by a separate build-time edition.

The extension contract lives in `src/edition/types.ts`. The committed `src/edition/manifest.ts` registers no private modules. A licensed build overlays that manifest and the private view files before running the normal type-check and Vite build.

This keeps one shared frontend implementation. The licensed edition is not a fork, and changes to shared tables, panels, authentication, or API handling stay in this repository.

Run the boundary check after a production build:

```sh
npm run build
npm run verify:opensource
```

CI runs the same check and fails if private source directories or private integration chunks return to the public build.
