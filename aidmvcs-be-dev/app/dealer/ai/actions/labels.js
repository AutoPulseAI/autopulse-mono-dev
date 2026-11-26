// A lead status as every screen words it (app/lib/statusLabels.js).
import { statusLabel } from "@lib/statusLabels";

export const leadStatusLabelFrom = (status) => (status ? statusLabel(status) || status : null);
