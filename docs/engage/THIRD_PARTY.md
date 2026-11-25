# Third-party code in Engage

## OpenReply keyword matcher

`src/lib/engage/keywords.ts` is ported from `lib/utils/keyword-matcher.ts` in
OpenReply (https://github.com/diwenne/openreply, commit 1eb827b). The automation
shape in `src/lib/engage/rules.ts` (keywords, whole-word match, any post or
chosen posts, a rotating pool of public replies, a private message) follows
OpenReply's `Automation` model. No other OpenReply code is used: Mellox sends
through its own Meta app (`src/server/engage/meta/graph.server.ts`).

```
MIT License

Copyright (c) 2026 Anish Raj
Copyright (c) 2026 Diwen Huang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
