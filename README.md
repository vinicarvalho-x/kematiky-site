# Kematiky Records — site

Site estático (um `index.html`) hospedado no GitHub Pages.

- **SoundCloud**: player oficial do perfil, que se atualiza sozinho.
- **Bandcamp**: `data/releases.json` é atualizado todo dia às 06:17 (horário de Brasília) pela GitHub Action `Sync Bandcamp releases`, que lê https://kematikyrecords.bandcamp.com e grava capas, faixas, datas e o ID do player de cada lançamento.

## Rodar a sincronização na hora
Aba **Actions** → *Sync Bandcamp releases* → **Run workflow**.

## Editar
- Artistas, textos e links: dentro de `index.html` (procure `const artists`).
- Para não perder alterações, não edite `data/releases.json` à mão: ele é sobrescrito a cada sincronização.
