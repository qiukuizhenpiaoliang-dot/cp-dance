# Contributing

CP Dance preserves independent character agency and consent boundaries.
Changes must not let one character author another character's behavior, expose
private thoughts to a counterpart, or treat animation playback as consent.

Before opening a pull request:

```bash
npm install
npm test
npm run desktop:test
npm run lint
git diff --check
```

Do not commit secrets, user saves, copyrighted character art, generated media,
or deployment-specific IDs. Tests must mock image generation.
