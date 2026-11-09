# Defensive patterns — rules enforced in review

Each pattern is a hard-won rule stated as a requirement, together with the defect it prevents, the objective condition a reviewer judges it by, and the boundary where it stops (and who may approve an exception).

In-file format for machine checking: each rule is its own `##` section and carries `**Prevents:**`, `**Reviewer check:**` and `**Boundary:**`, followed by a correct and a wrong example. Read the topic page for the artifact you are about to change, before you change it.

Validate with `node scripts/ake.mjs validate`; retrieve with `node scripts/ake.mjs search <terms>`.
