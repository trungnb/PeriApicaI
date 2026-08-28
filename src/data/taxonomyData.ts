import { BilingualTaxonomyErrorItem, ToothInfo, ErrorDomainId } from '../types/dental';

export type { BilingualTaxonomyErrorItem };

export const TAXONOMY_ERRORS: BilingualTaxonomyErrorItem[] = [
  // Domain 1: Receptor Placement Errors
  {
    key: 'missing_apical',
    domainId: 'domain_1',
    label: 'Mất vùng cuống răng',
    labelEn: 'Missing Apical Region',
    description: 'Phim chưa đủ sâu, mất hoặc cắt gọt vùng cuống răng hay xương quanh cuống dưới 2–3mm.',
    descriptionEn: 'The periapical area is cut off; less than 2-3 mm of surrounding periapical bone is visible.',
    remediation: 'Đặt bộ nhận ảnh nhô ra ít nhất 2–3 mm qua mặt nhai/bờ cắn. Sử dụng bộ giữ phim hoặc cảm biến có khối cắn cố định.',
    remediationEn: 'Ensure the receptor extends 2–3 mm beyond the incisal/occlusal edge and is placed deeply into the palate or floor of the mouth.',
  },
  {
    key: 'missing_coronal_mesial_distal',
    domainId: 'domain_1',
    label: 'Mất vùng thân răng, phía gần hoặc phía xa',
    labelEn: 'Missing Coronal / Mesial / Distal',
    description: 'Phim bị lệch quá nhiều về phía gần hoặc xa, bỏ sót mặt cắn hoặc tiếp xúc kẽ kề bên.',
    descriptionEn: 'Receptor positioned too far mesially or distally, cutting off the crown, incisal edge, or adjacent contact.',
    remediation: 'Căn bờ trước cảm biến trùng với đường giữa răng kế cận, đặt bộ nhận ảnh vào đúng trung tâm vùng răng mục tiêu.',
    remediationEn: 'Align anterior edge of receptor with midline of adjacent tooth; center receptor squarely on target tooth.',
  },
  {
    key: 'wrong_target_tooth',
    domainId: 'domain_1',
    label: 'Không khớp vị trí răng mục tiêu',
    labelEn: 'Wrong Target Tooth Position',
    description: 'Chọn vị trí răng trên sơ đồ một đằng nhưng chụp nhầm vùng răng khác.',
    descriptionEn: 'Selected tooth location does not match the actual tooth captured on the radiograph.',
    remediation: 'Kiểm tra sơ đồ răng FDI trước khi đặt cảm biến; đặt đúng trung tâm vùng răng được chỉ định.',
    remediationEn: 'Verify FDI dental chart before receptor placement; center receptor precisely on designated anatomical region.',
  },
  {
    key: 'not_periapical',
    domainId: 'domain_1',
    label: 'Ảnh không phải phim X-quang cận chóp',
    labelEn: 'Not a Periapical Radiograph',
    description: 'Hình ảnh tải lên không thuộc chuẩn kỹ thuật phim X-quang quanh chóp chuẩn.',
    descriptionEn: 'Uploaded image is not a recognized clinical periapical radiograph.',
    remediation: 'Tải lên đúng phim X-quang quanh chóp chuẩn nha khoa.',
    remediationEn: 'Upload a valid clinical dental periapical radiograph.',
  },
  {
    key: 'tilted_occlusal',
    domainId: 'domain_1',
    label: 'Mặt phẳng nhai bị nghiêng',
    labelEn: 'Tilted Occlusal Plane',
    description: 'Phim không song song với mặt phẳng nhai làm hình ảnh răng bị xếch nghiêng.',
    descriptionEn: 'Receptor is not parallel to the occlusal plane, causing a tilted or skewed dental image.',
    remediation: 'Đặt cạnh bộ nhận ảnh song song với mặt nhai. Hướng dẫn bệnh nhân cắn chặt đều lên khối cắn của bộ giữ phim.',
    remediationEn: 'Position receptor edge parallel to occlusal surfaces. Instruct patient to bite firmly and evenly on bite block.',
  },

  // Domain 2: Angulation & Geometric Errors
  {
    key: 'elongation',
    domainId: 'domain_2',
    label: 'Hình ảnh bị kéo dài',
    labelEn: 'Vertical Elongation',
    description: 'Chiều dài chân răng bị kéo dài bất thường do góc đứng quá nhỏ.',
    descriptionEn: 'Teeth appear abnormally long due to insufficient (too flat) vertical angulation.',
    remediation: 'Tăng góc đứng của ống định hướng chùm tia. Trục tia trung tâm cần dốc hơn.',
    remediationEn: 'Increase the vertical angulation of the PID (steeper angle directed towards receptor plane).',
  },
  {
    key: 'foreshortening',
    domainId: 'domain_2',
    label: 'Hình ảnh bị ngắn nét',
    labelEn: 'Vertical Foreshortening',
    description: 'Chiều dài chân răng bị thu ngắn, tù mập bất thường do góc đứng quá lớn.',
    descriptionEn: 'Teeth appear abnormally short and stubby due to excessive (too steep) vertical angulation.',
    remediation: 'Giảm góc đứng của ống định hướng chùm tia. Trục tia trung tâm cần bớt dốc lại.',
    remediationEn: 'Decrease the vertical angulation of the PID (flatten angle towards horizontal plane).',
  },
  {
    key: 'overlapping',
    domainId: 'domain_2',
    label: 'Chồng vệt tiếp xúc kẽ răng',
    labelEn: 'Overlapping Interproximal Contacts',
    description: 'Sai góc ngang làm men răng vùng kẽ kế cận bị dính lấp lên nhau.',
    descriptionEn: 'Incorrect horizontal angulation causing adjacent interproximal enamel surfaces to overlap.',
    remediation: 'Chỉnh tia X trung tâm đi xuyên vuông góc qua kẽ răng và đường cong cung răng tại điểm tiếp xúc kẽ.',
    remediationEn: 'Direct the central ray perpendicularly through the contact areas and curvature of the dental arch.',
  },
  {
    key: 'cone_cut',
    domainId: 'domain_2',
    label: 'Cắt gọt chùm tia',
    labelEn: 'Cone-Cut Artefact',
    description: 'Chùm tia X không bao phủ hết diện tích cảm biến, tạo vệt cản quang khuyết trắng.',
    descriptionEn: 'X-ray beam did not completely cover the receptor, producing a clear unexposed crescent or straight boundary.',
    remediation: 'Căn ống định hướng chùm tia bao phủ hoàn toàn diện tích phim và đồng tâm với vòng định vị.',
    remediationEn: 'Center the PID directly over the receptor and align concentric with the aiming ring.',
  },

  // Domain 3: Exposure, Processing & Artefact Errors
  {
    key: 'underexposed_overexposed',
    domainId: 'domain_3',
    label: 'Thiếu tia / Thừa tia',
    labelEn: 'Underexposed / Overexposed',
    description: 'Ảnh quá sáng, nhiễu hạt hoặc quá tối, cháy phim do thông số phát tia hay thời gian chưa phù hợp.',
    descriptionEn: 'Image is excessively noisy/light (underexposed) or too dark/burnt (overexposed) due to improper kVp/mA/time.',
    remediation: 'Điều chỉnh tăng hoặc giảm thông số phát tia theo thể trạng bệnh nhân, thể tích mô xương và độ nhạy của cảm biến.',
    remediationEn: 'Adjust exposure parameters (exposure time/mA/kVp) according to patient bone density and receptor sensitivity.',
  },
  {
    key: 'motion_blur',
    domainId: 'domain_3',
    label: 'Bị nhòe do chuyển động',
    labelEn: 'Patient / Tubehead Motion Blur',
    description: 'Phim bị mờ nhòe, ranh giới ống tủy hay bè xương không sắc nét do chuyển động.',
    descriptionEn: 'Loss of sharpness and anatomical trabecular detail caused by patient movement or tubehead drift.',
    remediation: 'Dặn bệnh nhân nín thở nhẹ, giữ nguyên đầu hoàn toàn. Cố định chắc chắn tay treo đầu bóng X-quang không rung lắc trước khi bấm tia.',
    remediationEn: 'Instruct patient to remain completely still. Stabilize the X-ray tubehead arm to prevent drifting before exposure.',
  },
  {
    key: 'reversed_receptor',
    domainId: 'domain_3',
    label: 'Đặt ngược bộ nhận ảnh',
    labelEn: 'Reversed Receptor Plate',
    description: 'Hình ảnh lờ mờ, nhiễu hạt kèm xuất hiện họa tiết lưới hoặc bóng dây cáp đè lên răng.',
    descriptionEn: 'Receptor placed backwards, resulting in a faint image with tire-track/geometric mesh lead foil pattern.',
    remediation: 'Lật lại phim hoặc cảm biến. Đảm bảo mặt nhận tia trơn nhẵn hướng về phía đầu đèn X-quang.',
    remediationEn: 'Flip receptor. Ensure the active side faces the teeth and the X-ray tubehead.',
  },
  {
    key: 'double_exposure',
    domainId: 'domain_3',
    label: 'Chồng hai lần phát tia',
    labelEn: 'Double Exposure Artefact',
    description: 'Hai hình ảnh giải phẫu bị chồng đè lên nhau trên cùng một tấm phim.',
    descriptionEn: 'Two distinct anatomical exposures captured onto the same single phosphor plate or film.',
    remediation: 'Phân loại riêng phim đã chụp và chưa chụp; luôn xóa tấm cảm biến trước khi tái sử dụng.',
    remediationEn: 'Separate exposed from unexposed PSP plates; always erase phosphor storage plates before reusing.',
  },
];

export const DOMAIN_TITLES: Record<ErrorDomainId, { name: string; description: string; nameEn?: string; descriptionEn?: string }> = {
  domain_1: {
    name: 'Miền 1: Lỗi đặt bộ nhận ảnh',
    description: 'Bao gồm các lỗi mất cuống, mất thân/kẽ, chọn nhầm răng mục tiêu và mặt phẳng nhai bị nghiêng.',
    nameEn: 'Domain 1: Receptor Placement Errors',
    descriptionEn: 'Includes missing apex, missing crown/interproximal, wrong target tooth, and tilted occlusal plane.',
  },
  domain_2: {
    name: 'Miền 2: Lỗi góc độ & Hình học',
    description: 'Bao gồm các lỗi góc đứng, góc ngang và cắt gọt chùm tia.',
    nameEn: 'Domain 2: Angulation & Geometric Errors',
    descriptionEn: 'Includes vertical elongation, foreshortening, horizontal overlapping, and cone-cut artefacts.',
  },
  domain_3: {
    name: 'Miền 3: Lỗi phát tia & Xử lý phim',
    description: 'Bao gồm các lỗi thiếu/thừa tia, mờ do chuyển động, đặt ngược cảm biến và chồng hai lần phát tia.',
    nameEn: 'Domain 3: Exposure, Processing & Artefacts',
    descriptionEn: 'Includes underexposure, overexposure, motion unsharpness, reversed receptor, and double exposure.',
  },
};

export const ALL_TEETH: ToothInfo[] = [
  // Maxilla Right (Q1)
  { fdiNumber: '18', universalNumber: '#1', name: 'Răng khôn hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Molar' },
  { fdiNumber: '17', universalNumber: '#2', name: 'Răng hàm lớn thứ 2 hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Molar' },
  { fdiNumber: '16', universalNumber: '#3', name: 'Răng hàm lớn thứ 1 hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Molar' },
  { fdiNumber: '15', universalNumber: '#4', name: 'Răng hàm nhỏ thứ 2 hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Premolar' },
  { fdiNumber: '14', universalNumber: '#5', name: 'Răng hàm nhỏ thứ 1 hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Premolar' },
  { fdiNumber: '13', universalNumber: '#6', name: 'Răng nanh hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Canine' },
  { fdiNumber: '12', universalNumber: '#7', name: 'Răng cửa bên hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Incisor' },
  { fdiNumber: '11', universalNumber: '#8', name: 'Răng cửa giữa hàm trên bên phải', arch: 'Maxilla', quadrant: 1, type: 'Incisor' },

  // Maxilla Left (Q2)
  { fdiNumber: '21', universalNumber: '#9', name: 'Răng cửa giữa hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Incisor' },
  { fdiNumber: '22', universalNumber: '#10', name: 'Răng cửa bên hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Incisor' },
  { fdiNumber: '23', universalNumber: '#11', name: 'Răng nanh hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Canine' },
  { fdiNumber: '24', universalNumber: '#12', name: 'Răng hàm nhỏ thứ 1 hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Premolar' },
  { fdiNumber: '25', universalNumber: '#13', name: 'Răng hàm nhỏ thứ 2 hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Premolar' },
  { fdiNumber: '26', universalNumber: '#14', name: 'Răng hàm lớn thứ 1 hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Molar' },
  { fdiNumber: '27', universalNumber: '#15', name: 'Răng hàm lớn thứ 2 hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Molar' },
  { fdiNumber: '28', universalNumber: '#16', name: 'Răng khôn hàm trên bên trái', arch: 'Maxilla', quadrant: 2, type: 'Molar' },

  // Mandible Right (Q4) - 48 to 41
  { fdiNumber: '48', universalNumber: '#32', name: 'Răng khôn hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Molar' },
  { fdiNumber: '47', universalNumber: '#31', name: 'Răng hàm lớn thứ 2 hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Molar' },
  { fdiNumber: '46', universalNumber: '#30', name: 'Răng hàm lớn thứ 1 hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Molar' },
  { fdiNumber: '45', universalNumber: '#29', name: 'Răng hàm nhỏ thứ 2 hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Premolar' },
  { fdiNumber: '44', universalNumber: '#28', name: 'Răng hàm nhỏ thứ 1 hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Premolar' },
  { fdiNumber: '43', universalNumber: '#27', name: 'Răng nanh hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Canine' },
  { fdiNumber: '42', universalNumber: '#26', name: 'Răng cửa bên hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Incisor' },
  { fdiNumber: '41', universalNumber: '#25', name: 'Răng cửa giữa hàm dưới bên phải', arch: 'Mandible', quadrant: 4, type: 'Incisor' },

  // Mandible Left (Q3) - 31 to 38
  { fdiNumber: '31', universalNumber: '#24', name: 'Răng cửa giữa hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Incisor' },
  { fdiNumber: '32', universalNumber: '#23', name: 'Răng cửa bên hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Incisor' },
  { fdiNumber: '33', universalNumber: '#22', name: 'Răng nanh hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Canine' },
  { fdiNumber: '34', universalNumber: '#21', name: 'Răng hàm nhỏ thứ 1 hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Premolar' },
  { fdiNumber: '35', universalNumber: '#20', name: 'Răng hàm nhỏ thứ 2 hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Premolar' },
  { fdiNumber: '36', universalNumber: '#19', name: 'Răng hàm lớn thứ 1 hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Molar' },
  { fdiNumber: '37', universalNumber: '#18', name: 'Răng hàm lớn thứ 2 hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Molar' },
  { fdiNumber: '38', universalNumber: '#17', name: 'Răng khôn hàm dưới bên trái', arch: 'Mandible', quadrant: 3, type: 'Molar' },
];

export const TAXONOMY_DICT = TAXONOMY_ERRORS.reduce((acc, curr) => {
  acc[curr.key] = curr;
  return acc;
}, {} as Record<string, BilingualTaxonomyErrorItem>);

/**
 * Shorthand and uppercase failure code aliases mapped to standardized taxonomy keys.
 * Enables zero-latency prompt compression (e.g. CONE_CUT, DBL_EXP) without large textual overhead.
 */
export const TECH_FAILURE_ALIASES: Record<string, string> = {
  // Direct Uppercase standard keys
  'MISSING_APICAL': 'missing_apical',
  'MISSING_CORONAL_MESIAL_DISTAL': 'missing_coronal_mesial_distal',
  'WRONG_TARGET_TOOTH': 'wrong_target_tooth',
  'NOT_PERIAPICAL': 'not_periapical',
  'TILTED_OCCLUSAL': 'tilted_occlusal',
  'ELONGATION': 'elongation',
  'FORESHORTENING': 'foreshortening',
  'OVERLAPPING': 'overlapping',
  'CONE_CUT': 'cone_cut',
  'UNDEREXPOSED_OVEREXPOSED': 'underexposed_overexposed',
  'MOTION_BLUR': 'motion_blur',
  'REVERSED_RECEPTOR': 'reversed_receptor',
  'DOUBLE_EXPOSURE': 'double_exposure',

  // Clinical Abbreviations & Shorthand codes
  'CONECUT': 'cone_cut',
  'DBL_EXP': 'double_exposure',
  'DBL_EXPOSURE': 'double_exposure',
  'DOUBLE_EXP': 'double_exposure',
  'MISSING_APEX': 'missing_apical',
  'APEX_CUT': 'missing_apical',
  'MISSING_CROWN': 'missing_coronal_mesial_distal',
  'WRONG_TOOTH': 'wrong_target_tooth',
  'WRONG_POSITION': 'wrong_target_tooth',
  'NON_DENTAL': 'not_periapical',
  'NON_PERIAPICAL': 'not_periapical',
  'TILTED': 'tilted_occlusal',
  'OCCLUSAL_TILT': 'tilted_occlusal',
  'OVERLAP': 'overlapping',
  'CONTACT_OVERLAP': 'overlapping',
  'UNDEREXPOSED': 'underexposed_overexposed',
  'OVEREXPOSED': 'underexposed_overexposed',
  'UNDER_OVER_EXPOSURE': 'underexposed_overexposed',
  'MOTION': 'motion_blur',
  'MOTION_UNSHARPNESS': 'motion_blur',
  'REVERSED': 'reversed_receptor',
  'BACKWARDS_RECEPTOR': 'reversed_receptor',
  'ARTEFACTS': 'underexposed_overexposed',
};

/**
 * Standard client-side Technical Failure Dictionary for single-source-of-truth lookup.
 */
export const TECH_FAILURE_DICT: Record<string, BilingualTaxonomyErrorItem> = TAXONOMY_DICT;

/**
 * Normalizes any technical error key or shorthand code into a standardized taxonomy key.
 */
export function normalizeTechFailureKey(rawKey: string): string {
  if (!rawKey) return '';
  const trimmed = rawKey.trim();
  const upper = trimmed.toUpperCase();
  if (TECH_FAILURE_ALIASES[upper]) {
    return TECH_FAILURE_ALIASES[upper];
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'radiopaque_artefacts' || lower === 'artefacts') return 'underexposed_overexposed';
  if (lower === 'motion_unsharpness') return 'motion_blur';
  if (TAXONOMY_DICT[lower]) return lower;
  return lower;
}

export function getRemediationText(errorKey: string, lang: 'VI' | 'EN' = 'VI'): string {
  const normalizedKey = errorKey === 'radiopaque_artefacts' ? 'artefacts' : errorKey === 'motion_unsharpness' ? 'motion_blur' : errorKey;
  const item = TAXONOMY_DICT[normalizedKey];
  if (!item) {
    return lang === 'EN'
      ? 'Adjust technical parameters and check receptor placement.'
      : 'Căn chỉnh lại các thông số kỹ thuật và kiểm tra vị trí đặt cảm biến.';
  }
  return lang === 'EN' ? (item.remediationEn || item.remediation) : item.remediation;
}

export function getTaxonomyLabel(errorKey: string, lang: 'VI' | 'EN' = 'VI'): string | undefined {
  let normalizedKey = errorKey.toLowerCase().trim();
  normalizedKey = normalizedKey === 'radiopaque_artefacts' ? 'artefacts' : normalizedKey === 'motion_unsharpness' ? 'motion_blur' : normalizedKey;
  const item = TAXONOMY_DICT[normalizedKey];
  if (!item) return undefined;
  return lang === 'EN' ? (item.labelEn || item.label) : item.label;
}

export function getDomainMeta(domainId: string, lang: 'VI' | 'EN' = 'VI'): { name: string; description: string } | undefined {
  const normalizedDomainId = domainId.toLowerCase().replace(' ', '_');
  const domain = DOMAIN_TITLES[normalizedDomainId as ErrorDomainId];
  if (!domain) return undefined;
  return {
    name: lang === 'EN' ? (domain.nameEn || domain.name) : domain.name,
    description: lang === 'EN' ? (domain.descriptionEn || domain.description) : domain.description,
  };
}

export function getDomainTitle(domainId: string, lang: 'VI' | 'EN' = 'VI'): string {
  const normalizedDomainId = domainId.toLowerCase().replace(' ', '_');
  const domain = DOMAIN_TITLES[normalizedDomainId as ErrorDomainId];
  if (!domain) return domainId;
  return lang === 'EN' ? (domain.nameEn || domain.name) : domain.name;
}

export function getToothDisplayName(tooth: ToothInfo, lang: 'VI' | 'EN' = 'VI'): string {
  if (lang === 'VI') return tooth.name;
  
  // English naming mapping for teeth
  const archName = tooth.quadrant <= 2 ? 'Maxillary' : 'Mandibular';
  const side = (tooth.quadrant === 1 || tooth.quadrant === 4) ? 'Right' : 'Left';
  const pos = tooth.fdiNumber[1];
  let toothTitle = '';
  switch (pos) {
    case '1': toothTitle = 'Central Incisor'; break;
    case '2': toothTitle = 'Lateral Incisor'; break;
    case '3': toothTitle = 'Canine'; break;
    case '4': toothTitle = '1st Premolar'; break;
    case '5': toothTitle = '2nd Premolar'; break;
    case '6': toothTitle = '1st Molar'; break;
    case '7': toothTitle = '2nd Molar'; break;
    case '8': toothTitle = '3rd Molar (Wisdom)'; break;
    default: toothTitle = tooth.name; break;
  }
  return `${archName} ${side} ${toothTitle}`;
}

export function getArchDisplayName(arch: string, lang: 'VI' | 'EN' = 'VI'): string {
  if (lang === 'VI') {
    if (arch === 'Maxilla' || arch.includes('trên')) return 'Hàm trên';
    if (arch === 'Mandible' || arch.includes('dưới')) return 'Hàm dưới';
    return arch;
  }
  if (arch === 'Maxilla' || arch.includes('trên')) return 'Maxillary Arch';
  if (arch === 'Mandible' || arch.includes('dưới')) return 'Mandibular Arch';
  return arch;
}

export function getToothTypeDisplayName(type: string, lang: 'VI' | 'EN' = 'VI'): string {
  if (lang === 'VI') {
    switch (type) {
      case 'Incisor':
      case 'Răng cửa':
        return 'Răng cửa';
      case 'Canine':
      case 'Răng nanh':
        return 'Răng nanh';
      case 'Premolar':
      case 'Răng hàm nhỏ':
        return 'Răng hàm nhỏ';
      case 'Molar':
      case 'Răng hàm lớn':
        return 'Răng hàm lớn';
      default:
        return type;
    }
  }
  switch (type) {
    case 'Răng cửa':
    case 'Incisor':
      return 'Incisor';
    case 'Răng nanh':
    case 'Canine':
      return 'Canine';
    case 'Răng hàm nhỏ':
    case 'Premolar':
      return 'Premolar';
    case 'Răng hàm lớn':
    case 'Molar':
      return 'Molar';
    default:
      return type;
  }
}

export function getTechniqueDisplayName(technique: string, lang: 'VI' | 'EN' = 'VI'): string {
  if (technique === 'Paralleling' || technique.toLowerCase().includes('song song')) {
    return lang === 'EN' ? 'Paralleling' : 'Song song';
  }
  return lang === 'EN' ? 'Bisecting Angle' : 'Phân giác';
}

export function getReceptorDisplayName(receptor: string, lang: 'VI' | 'EN' = 'VI'): string {
  if (receptor === 'Digital Sensor' || receptor.toLowerCase().includes('cảm biến') || receptor.toLowerCase().includes('kỹ thuật số')) {
    return lang === 'EN' ? 'Digital Sensor' : 'Cảm biến Kỹ thuật số';
  }
  return lang === 'EN' ? 'Phosphor Plate / Film' : 'Tấm Phosphor / Phim truyền thống';
}

