import type { InventoryKind, ItemStatus } from "./domain";

export type InventoryFormValues = {
  kind: InventoryKind;
  name: string;
  serialNumber: string;
  techSpec: string;
  manufacturer: string;
  locationId: string;
  status: ItemStatus;
  statusReason: string;
  manufactureDate: string;
  firstUseDate: string;
  lifespanMode: "finite" | "explicit" | "unlimited";
  lifespanMonths: string;
  expiryBasis: "" | "manufacture_date" | "first_use_date";
  explicitExpiry: string;
  annualInspectionRequired: boolean;
  inspectionIntervalMonths: string;
  lastInspectionDate: string;
  nextInspectionDate: string;
  lastUseDate: string;
  technicalDetails: string;
  notes: string;
  tags: string[];
  quantityUnit: "" | "units" | "metres" | "litres" | "kg";
  reorderThreshold: string;
  initialQuantity: string;
  purpose: string;
};

export function emptyInventoryValues(kind: InventoryKind, locationId: string): InventoryFormValues {
  return {
    kind,
    name: "",
    serialNumber: "",
    techSpec: "",
    manufacturer: "",
    locationId,
    status: "available",
    statusReason: "",
    manufactureDate: "",
    firstUseDate: "",
    lifespanMode: "unlimited",
    lifespanMonths: "",
    expiryBasis: "",
    explicitExpiry: "",
    annualInspectionRequired: kind === "component",
    inspectionIntervalMonths: "12",
    lastInspectionDate: "",
    nextInspectionDate: "",
    lastUseDate: "",
    technicalDetails: "",
    notes: "",
    tags: [],
    quantityUnit: kind === "consumable" ? "units" : "",
    reorderThreshold: "",
    initialQuantity: "",
    purpose: "",
  };
}

