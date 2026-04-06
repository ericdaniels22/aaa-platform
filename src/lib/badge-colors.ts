export const statusColors: Record<string, string> = {
  new: "bg-[#FAEEDA] text-[#633806]",
  in_progress: "bg-[#E1F5EE] text-[#085041]",
  pending_invoice: "bg-[#EEEDFE] text-[#3C3489]",
  completed: "bg-[#F1EFE8] text-[#5F5E5A]",
  cancelled: "bg-[#F1EFE8] text-[#5F5E5A]",
};

export const statusLabels: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  pending_invoice: "Pending Invoice",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const urgencyColors: Record<string, string> = {
  emergency: "bg-[#FCEBEB] text-[#791F1F]",
  urgent: "bg-[#FAEEDA] text-[#633806]",
  scheduled: "bg-[#E6F1FB] text-[#0C447C]",
};

export const urgencyLabels: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  scheduled: "Scheduled",
};

export const damageTypeColors: Record<string, string> = {
  water: "bg-[#E6F1FB] text-[#0C447C]",
  fire: "bg-[#FAECE7] text-[#712B13]",
  mold: "bg-[#EAF3DE] text-[#27500A]",
  storm: "bg-[#EEEDFE] text-[#3C3489]",
  biohazard: "bg-[#FCEBEB] text-[#791F1F]",
  contents: "bg-[#FFF8E6] text-[#7A5E00]",
  rebuild: "bg-[#F1EFE8] text-[#5F5E5A]",
  other: "bg-[#F1EFE8] text-[#5F5E5A]",
};

export const damageTypeLabels: Record<string, string> = {
  water: "Water",
  fire: "Fire",
  mold: "Mold",
  storm: "Storm",
  biohazard: "Biohazard",
  contents: "Contents",
  rebuild: "Rebuild",
  other: "Other",
};
