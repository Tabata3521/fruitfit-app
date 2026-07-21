import { normalizeRestrictionKeys, restrictionLabels } from "./restrictionModel.js";

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstArrayLike(...values) {
  return values.find((value) => (Array.isArray(value) && value.length > 0) || (typeof value === "string" && value.trim())) ?? null;
}

function booleanFlag(...values) {
  return values.some((value) => value === true || String(value || "").toLowerCase() === "true");
}

export function programRestrictionState({ profile = {}, course = {}, programAssignment = null } = {}) {
  const assignment = programAssignment || {};
  const serverProgram = assignment.program || assignment.assignedProgram || assignment.assigned_program || {};
  const explicitKeys = firstArrayLike(
    assignment.restrictionKeys,
    assignment.restriction_keys,
    serverProgram.restrictionKeys,
    serverProgram.restriction_keys,
    course.restrictionKeys,
    course.restriction_keys,
  );
  const matched = firstArrayLike(
    assignment.matchedRestrictions,
    assignment.matched_restrictions,
    serverProgram.matchedRestrictions,
    serverProgram.matched_restrictions,
  );
  const unmatched = normalizeRestrictionKeys(firstArrayLike(
    assignment.unmatchedRestrictions,
    assignment.unmatched_restrictions,
    assignment.missingRestrictions,
    assignment.missing_restrictions,
    serverProgram.unmatchedRestrictions,
    serverProgram.unmatched_restrictions,
  ) || []).filter((key) => key !== "none");

  const fallbackProfileKeys = normalizeRestrictionKeys(
    profile.restrictionKeys ?? profile.restriction_keys,
    profile.restrictions,
  );
  const combinedServerKeys = matched
    ? [...normalizeRestrictionKeys(matched).filter((key) => key !== "none"), ...unmatched]
    : null;
  const keys = normalizeRestrictionKeys(
    explicitKeys ?? combinedServerKeys ?? fallbackProfileKeys,
    firstDefined(course.restrictions, serverProgram.restrictions, assignment.restrictions, profile.restrictions),
  );
  const missingCombination = booleanFlag(
    assignment.missingCombinationTemplate,
    assignment.missing_combination_template,
    serverProgram.missingCombinationTemplate,
    serverProgram.missing_combination_template,
  );

  return {
    keys,
    labels: restrictionLabels(keys),
    unmatchedKeys: unmatched,
    unmatchedLabels: restrictionLabels(unmatched),
    requiresAdaptation: missingCombination || unmatched.length > 0,
  };
}
