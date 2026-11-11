# Convergence evaluation

Changing three fields does not itself prove a defect. Use a scripted model to exercise state-machine behavior independently of model quality.

1. Complete round 1 with an unresolved, evidence-supported issue.
2. Change the source, complete round 2 with no net progress.
3. Change the source, complete round 3 with no net progress. This round must already set needs_human.
4. Recheck unchanged source. Preserve needs_human and do not add a fourth round.
5. A separate case introduces new issue IDs in every round and must also escalate.

The integration tests implement both paths. A real-model evaluation must not assert that arbitrary changes necessarily cause new defects.
