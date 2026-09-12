/**
 * VM sizes Microsoft documents as retired/legacy generations. Azure has no API to
 * query this, so the list is maintained by hand — revisit periodically against
 * https://learn.microsoft.com/azure/virtual-machines/sizes-previous-gen.
 */
const DEPRECATED_VM_SIZES = new Set(
  [
    "Basic_A0", "Basic_A1", "Basic_A2", "Basic_A3", "Basic_A4",
    "Standard_A0", "Standard_A1", "Standard_A2", "Standard_A3", "Standard_A4",
    "Standard_A5", "Standard_A6", "Standard_A7",
    "Standard_A1_v2", "Standard_A2_v2", "Standard_A4_v2", "Standard_A8_v2",
    "Standard_A2m_v2", "Standard_A4m_v2", "Standard_A8m_v2",
    "Standard_D1", "Standard_D2", "Standard_D3", "Standard_D4",
    "Standard_D11", "Standard_D12", "Standard_D13", "Standard_D14",
    "Standard_D1_v2", "Standard_D2_v2", "Standard_D3_v2", "Standard_D4_v2", "Standard_D5_v2",
    "Standard_D11_v2", "Standard_D12_v2", "Standard_D13_v2", "Standard_D14_v2", "Standard_D15_v2",
    "Standard_DS1", "Standard_DS2", "Standard_DS3", "Standard_DS4",
    "Standard_DS11", "Standard_DS12", "Standard_DS13", "Standard_DS14",
    "Standard_DS1_v2", "Standard_DS2_v2", "Standard_DS3_v2", "Standard_DS4_v2", "Standard_DS5_v2",
    "Standard_DS11_v2", "Standard_DS12_v2", "Standard_DS13_v2", "Standard_DS14_v2", "Standard_DS15_v2",
    "Standard_G1", "Standard_G2", "Standard_G3", "Standard_G4", "Standard_G5",
    "Standard_GS1", "Standard_GS2", "Standard_GS3", "Standard_GS4", "Standard_GS5",
  ].map((size) => size.toLowerCase()),
);

export function isDeprecatedVmSize(vmSize: string): boolean {
  return DEPRECATED_VM_SIZES.has(vmSize.toLowerCase());
}
