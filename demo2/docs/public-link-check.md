# Public-link check

Checked October 21, 2026: HTTP requests at approximately 2:19 p.m. and presentation browser verification at approximately 2:22 p.m., America/Los_Angeles. This check covers the two website URL sets referenced in the repository and planning materials, the shared presentation, and the repository URL.

## Method and results

The HTTP checks used unauthenticated GET requests with `curl`, followed redirects, and verified TLS certificates. No account cookies or authorization headers were supplied. A separate Playwright CLI check used the existing Chrome installation in a fresh, nonpersistent browser session without loading any saved profile or authentication state. No sharing settings or website content were changed, and no slide deck was exported or downloaded.

| URL | HTTP / redirects | Returned title | Observed access |
| --- | --- | --- | --- |
| [GC and subcontractor coordination: Home](https://sites.google.com/view/gc-and-subcontractor-coordinat/home) | `200` / 0 | `GC and subcontractor coordination` | Public project HTML; RFI content and both public-project names present. |
| [GC and subcontractor coordination: Data](https://sites.google.com/view/gc-and-subcontractor-coordinat/data) | `200` / 0 | `GC and subcontractor coordination - Data` | Public Data content; Lee-Whedon, Willis, and the 17-record count present. |
| [AI-assisted RFI Pre-Routing: Home](https://sites.google.com/uw.edu/ai-assisted-rfi-pre-routing/home) | `200` / 0 | `AI-assisted RFI Pre-Routing` | Public project HTML; RFI, general-contractor, and subcontractor content present. |
| [AI-assisted RFI Pre-Routing: Data](https://sites.google.com/uw.edu/ai-assisted-rfi-pre-routing/data) | `200` / 0 | `AI-assisted RFI Pre-Routing - Data` | Public Data content; Lee-Whedon, Willis, and the 17-record count present. |
| [Shared presentation](https://docs.google.com/presentation/d/1uogy_w6I_XyHIMQvJlo3LRK1j2nPVc3sPa-Fc8xgctM/edit) | `200` / 0 | `Thesis - Google Slides` | Slide content rendered in a fresh anonymous browser; first slide visually verified. |
| [Team repository](https://github.com/LouisLin69/info492-rfi-coordination) | `404` / 0 | `Page not found · GitHub · GitHub` | Anonymous access does not expose this private repository. |

The four Sites pages returned substantial project HTML rather than a sign-in page. No sign-in, request-access, or page-not-found marker was detected in their visible HTML text. Each page's `og:url` metadata names its own requested URL. The two Home pages and the two Data pages have different normalized visible text, so they should be treated as distinct published versions rather than interchangeable redirect aliases.

## Canonical website decision

The root README previously listed the `sites.google.com/view/gc-and-subcontractor-coordinat` version, while the planning materials and web-presence note listed `sites.google.com/uw.edu/ai-assisted-rfi-pre-routing`. Both versions are currently accessible. Access and content checks do not establish an owner-designated canonical version or which version should receive future updates.

The repository link lists now identify both versions by their returned titles. Existing working URLs were retained. Selecting one canonical version remains a site-owner decision; no URL was guessed or replaced, and no site was republished.

## Presentation and repository limits

The HTTP presentation response contained its title and `Slideshow`, `Sign in`, and JavaScript-related controls. No `Request access`, `You need access`, or `You need permission` marker was detected in that visible HTML. Because a `200` shell alone was insufficient evidence of slide rendering, the exact presentation URL was then opened in the fresh anonymous browser session.

The browser visibly rendered the first slide, titled `Thesis + Coordination Posture Design`, and a populated slide filmstrip. The DOM exposed nine numbered slides. The `Sign in` button remained visible, and the sharing control's accessible description stated that anyone with the link could use the file without signing in. This confirms anonymous access to rendered slide content at the time of the check. No edit, export, download, or sharing action was performed. The check did not individually exercise all slides, presentation-mode transitions, or embedded media. Temporary browser snapshots and the visual-check screenshot were removed after inspection; no deck copy was added to the repository.

The repository is private. Its unauthenticated GitHub `404` response is consistent with that access boundary and is not evidence that the repository is missing. Repository access for the instructor or other intended reviewers requires the appropriate GitHub permissions; this check does not change repository visibility.

The research browser reported these Google URLs as inaccessible through its own tool. The table above uses successful direct HTTP requests and the separate anonymous browser check instead; a tool limitation was not treated as a broken link. The Sites HTTP checks did not exercise JavaScript, embedded media, or every outgoing source link. These observations do not establish future permissions or test the Demo 2 application, API, or deployment.
