# VPet adapted rules

Source: https://github.com/LorisYounger/VPet/blob/c24f712db51f92ff92e8546bb3e59364d4155d74/VPet-Simulator.Core/Handle/GameSave.cs

Upstream authors: LorisYounger and VPet contributors. License: Apache License 2.0; full license in `VPet-Apache-2.0.txt`.

Adapted level formula and next-level threshold into `src/contracts/companion/companion-care.ts`, and the bounded 0–100 value pattern into `src/main/modules/companion/domain/companion-care.ts`. September 2026 changes: immutable TypeScript state, local item catalog, non-punitive online decay, serialized idempotent transactions, local daily/focus rewards. WPF, LinePutScript, upstream character art/animations, models and third-party media are not included. This is partial rule reuse, not VPet save/mod compatibility or integration of the entire application.
