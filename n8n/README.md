# Tour database in n8n

The plugin's tour database is two n8n workflows in front of two n8n data tables. They live in the
personal project on `https://n8n.teddybiere.info`. The `*.workflow.js` files here are the same workflows in n8n
Workflow SDK code, kept for review and to rebuild them on another n8n instance.

## Data tables

| Table | Columns | Content |
|---|---|---|
| `FioriGuideTours` | `tour_id`, `title`, `entry`, `definition`, `version`, `updated_by` (+ n8n's `createdAt`, `updatedAt`) | One row per tour. `definition` is the full tour JSON with steps, `entry` the same without steps (what the catalog list returns). `title` is only for reading the table. |
| `FioriGuideConfig` | `publish_key` | One row. Authors must send this key to save or delete tours. Change the value to rotate the key. |

## Workflows

| Workflow | Webhooks | What it does |
|---|---|---|
| **Fiori Guide \| Load tours (API)** (`load-tours.workflow.js`) | `GET /webhook/fiori-guide/tours`, `GET /webhook/fiori-guide/tour?id=<id>` | Returns `{ tours: [...] }` (catalog entries without steps) or `{ tour }` with steps; 404 for an unknown id. |
| **Fiori Guide \| Save tours (API)** (`save-tours.workflow.js`) | `POST /webhook/fiori-guide/save` body `{ key, tour, user }`, `POST /webhook/fiori-guide/delete` body `{ key, id, user }` | Checks `key` against `FioriGuideConfig`, then upserts (by `tour_id`) or deletes the row. 401 for a wrong key, 400 for a tour without id or steps. |

Both workflows must be **published (active)** for the production URLs to answer. All webhooks allow any origin
(CORS `*`); set *Allowed Origins* on the four webhook nodes to your Launchpad host
(e.g. `https://s4dev.example.com`) to narrow that down. Reading tours needs no key, like reading `tours/index.json`.

## Plugin configuration

`toursApiUrl` (manifest default) is `https://n8n.teddybiere.info/webhook/fiori-guide`. Override it per Launchpad
with the target mapping parameter `toursApiUrl`, or set it to an empty value to switch the database off.

The users' browsers call n8n directly, so the n8n host must be reachable from where people open the Launchpad.

## Quick check

```sh
curl https://n8n.teddybiere.info/webhook/fiori-guide/tours
curl "https://n8n.teddybiere.info/webhook/fiori-guide/tour?id=<tour id>"
```
