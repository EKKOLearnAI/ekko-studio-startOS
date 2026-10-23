# Ekko Studio for fnOS

This is the EKKOLearnAI-maintained fnOS package in
`EKKOLearnAI/ekko-studio-startOS`. The repository also contains a separate
StartOS wrapper at its root. fnOS uses `.fpk`; StartOS uses `.s9pk`.

## Build and download

Run **Actions → Build fnOS FPK → Run workflow** on a branch containing this
directory. Until the fnOS PR is merged, select `feat/fnos-package`.
The workflow produces separate native **x86** and **ARM64** packages in the
`fnos-fpk` artifact. Building does not submit to the fnOS App Center or publish
to the Start9 registry.

The workflow builds the pinned Ekko Studio source on native x64/ARM64 runners
inside Ubuntu 22.04, bundles a checksum-pinned Node.js distribution, checks ELF
architecture/glibc requirements, and runs the actual server as UID 1000.
The official checksum-pinned `fnpack` assembles and inspects both packages in
an x64 job. Its public ARM64 download was unavailable when this was added.

`package-config.json` records the application commit, version, packaging
revision and tool checksums. Update them together and repeat both native jobs.
There is no copied third-party FPK or third-party distributor identity.

For a local build, put the exact upstream checkout at `.upstream` in this
repository, then run:

```sh
docker build --progress=plain -f fnos/Dockerfile.build -t ekko-fnos-payload .
```

The image contains `/payload`; see the workflow for export and fnpack assembly.
Its Docker build is a build/test environment. The installed FPK runs natively
as the fnOS package user.

## Runtime and login

- Application ID, user and group: `ekko-studio`.
- Developer and distributor: **EKKOLearnAI**.
- Application version: `0.7.38`; FPK revision: `0.7.38-1`.
- Dedicated non-root package identity; root startup is refused.
- Private Node runtime; no dependency on the fnOS Node application package.
- Install wizard requires a 12–256 character password for username `admin`.
  Initialization binds a temporary server only to loopback, changes the default
  credential using upstream's API, verifies login/default-password rejection,
  then removes the temporary plaintext input. Public startup is blocked until
  initialization finishes. Reconfiguration does not reset an existing password.
- Port **8648**, direct browser entry, Studio's own authentication. This package
  does not claim fnOS gateway authentication or automatic HTTPS integration.
- Hermes is **not bundled**. Install a managed runtime from Studio's runtime
  manager when needed. The package itself does not require a host Python venv.
- Package-owned data lives under `TRIM_PKGVAR`: `studio` (database/runtime/state),
  `home`, `workspaces`, `cache`, `tmp`, `npm`, PID identity and service logs.
  Package updates must preserve this directory. Export/back up data before
  uninstalling; the fnOS App Center's removal policy still needs device testing.
- Access to other NAS directories remains subject to fnOS authorization and
  the application account's permissions. No broad shared-directory access or
  extra privileged groups are declared.
- Studio/Python tool features can require host Git and other tool dependencies;
  no host packages are installed by lifecycle scripts.
- Logs are private to the application account and rotated at startup once
  larger than 10 MiB; long-running log growth still needs operational monitoring.

The official application ID differs from the third-party `hermes-studio`
package. This is not an automatic migration of that package's accounts/data.
The same port cannot be used by both installations simultaneously.

## Verification scope

`tests/control.test.mjs` checks unsafe paths, secret filtering, PID ownership
and root rejection. `tests/smoke.mjs` tests the actual packaged application:
non-root process ownership, login, default credential rejection, protected
APIs, traversal rejection, HTTP/Socket.IO transport, absence of a bundled
managed Hermes runtime, idempotent start, stop, unrelated PID handling and
password/workspace persistence after restart/reconfiguration.

These are native Linux/container checks, **not fnOS device acceptance**.
Before marketplace submission, test the actual FPK on each declared fnOS
architecture: wizard callbacks, installation, card entry, start/stop,
permissions, runtime download/activation, upgrade, uninstall and data handling.
Do not describe a container test as an App Center installation test.

## Official references

- https://developer.fnnas.com/docs/cli/fnpack/
- https://developer.fnnas.com/docs/core-concepts/manifest/
- https://developer.fnnas.com/docs/core-concepts/privilege/
- https://developer.fnnas.com/docs/core-concepts/environment-variables/
- https://developer.fnnas.com/docs/core-concepts/wizard/
- https://developer.fnnas.com/docs/core-concepts/app-entry/

The application and logo retain the upstream Business Source License.
