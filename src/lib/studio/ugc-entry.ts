// The UGC video ad lives in its own studio (src/components/app/ugc/) with its
// own pipeline — a creator, a Brand DNA product, a script, a render — so it
// isn't a StudioType/STUDIO_FORMATS entry. This is the small, display-only
// card description shared by every surface that offers it as a way to create
// (the Create launcher, the command bar): picking it opens `open:ugc-studio`
// instead of a Studio composer session.
export const UGC_ENTRY = {
  id: "ugc" as const,
  group: "video" as const,
  label: "Creator video ad",
  noun: "creator video ad",
  description: "Pick a creator, write what they say, done",
  badge: "New",
};
