# Notices

## Independent project

Code Command Center is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, Elgato, Corsair, Microsoft or Docker.

## Names

Claude and Claude Code are names of Anthropic. Stream Deck is a name of Elgato, a brand of Corsair. Visual Studio Code and VS Code are names of Microsoft. Docker is a name of Docker, Inc. macOS is a name of Apple. These names are trademarks of their owners and are used here only to say what the software works with.

## The Code Command Center logo

The Code Command Center logo, three arrow badges in a row that point to the right, is the property of Thomas Albin. It is an original drawing made for this project. The license of the software does not cover it: without Thomas Albin's written consent it may not be used, changed, sold or resold. The one exception is that it may stay in copies of the software and be shown there as the software's icon. The full wording is under [The logo](LICENSE.md#the-logo) in LICENSE.md.

## Logos of others

This repository contains no logo of any of these companies. On the keys, the plugin draws two plain marks of its own: a sparkle for the Claude app and a pair of angle brackets for VS Code.

Where the Claude Code extension for VS Code, or VS Code itself, is installed on a Mac, the plugin reads that app's logo from the app's own files on that Mac and shows it on the keys of the Stream Deck connected to it. The logos stay with their owners. They are not part of this project and are not licensed by it.

## Software this project uses

The plugin runs on Elgato's Stream Deck SDK for Node.js and the packages that SDK depends on. All of them are under the MIT License:

| Package | Version |
|---|---|
| `@elgato/streamdeck` | 3.0.2 |
| `@elgato/schemas` | 0.5.2 |
| `@elgato/utils` | 0.6.1 |
| `ws` | 8.22.0 |
| `zod` | 3.25.76 |

They are not in this repository. `npm` fetches them when the plugin is installed from source, and the packaged plugin file holds them in `node_modules`, each with its own license file.

## The license text

The PolyForm Noncommercial License 1.0.0 in [LICENSE.md](LICENSE.md) is published by the PolyForm Project at <https://polyformproject.org/licenses/noncommercial/1.0.0> and is reproduced without changes.
