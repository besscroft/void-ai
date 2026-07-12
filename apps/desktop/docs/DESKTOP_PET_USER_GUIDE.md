# Desktop pets

Desktop pets are optional animated companions for the main Void agent. They reflect task activity without changing how the agent works. Child agents never create separate pets.

## Choose and wake a pet

1. Open **Settings > Pets**.
2. Choose a pet in **My pets**. Paimon is the single built-in pet and is available offline.
3. Turn on **Wake pet** to show the floating companion.

Only one pet can be selected at a time. The selection, awake state, position, and always-on-top preference persist across restarts. Click the floating pet to open the highest-priority main-agent task, drag it to reposition it, or use its context menu to open settings, reset its position, or tuck it away.

## Activity states

| Status      | Meaning                                                        | Animation |
| ----------- | -------------------------------------------------------------- | --------- |
| Idle        | No main-agent task currently needs attention.                  | `idle`    |
| Sleeping    | The main agent has remained idle for at least 60 seconds.      | still     |
| Running     | A main-agent task is queued or running.                        | `running` |
| Needs input | A task is waiting for approval or handoff input.               | `waiting` |
| Ready       | A completed task has not been opened from the pet.             | `review`  |
| Run failed  | A main-agent task failed and has not been opened from the pet. | `failed`  |

When several main-agent tasks have activity, the pet prioritizes Needs input, Blocked, Ready, then Running. Child-agent runs are excluded. Opening a Ready or Blocked task marks that activity as read.

Pets respect the app and operating system reduced-motion preference. V2 pets use their neutral frame when motion is reduced; otherwise their additional 16 frames follow the pointer while idle.

## Install community pets

The native **Store** view reads the public safe-content catalog from [codex-pets.net](https://codex-pets.net/). Search, filter, and download a pet, then return to **My pets** to use it. Downloads are validated before they are installed. An installed store pet shows an update action when its remote version changes.

Store downloads are saved only on this device and do not sync to other installations.

## Import local pets

Use **Import package** for `.zip` or `.codex-pet.zip` files, or **Import folder** for an unpacked pet. A package must contain:

- `pet.json`
- `spritesheet.webp`

Files may be at the package root or in one enclosing folder. V1 sheets are 1536×1872; V2 sheets are 1536×2288 and declare `"spriteVersionNumber": 2`. Optional Codex animation tracks are supported. Invalid paths, oversized files, malformed manifests, and incompatible dimensions are rejected before anything is written.

If an imported id already exists, Void asks before atomically replacing it. The `paimon` id is reserved for the bundled pet. Community and local pets can be deleted. Deleting the active pet switches to built-in Paimon first; built-in pets cannot be deleted.

## Storage and network behavior

- Built-in Paimon asset: bundled with the desktop application under `resources/pets/paimon`
- Community and local pets: `<userData>/data/pets/installed/<id>`
- Store requests always use safe-content mode.
- A failed restore keeps the selection and awake preference but does not create a broken floating window.
