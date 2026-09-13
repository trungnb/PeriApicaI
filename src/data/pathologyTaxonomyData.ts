import {
  PathologyKey,
  PathologyDomainId,
  PathologyTaxonomyItem,
  TreatmentProtocol,
} from '../types/dental';

// ============================================================
// PATHOLOGY TAXONOMY — 8 Standardized Keys (Strictly aligned with Luồng A)
// ============================================================

const mkProtocol = (
  key: PathologyKey,
  severity: TreatmentProtocol['severity'],
  urgency: TreatmentProtocol['urgency'],
  primaryVi: string,
  primaryEn: string,
  followUpVi: string,
  followUpEn: string,
  referral?: boolean,
): TreatmentProtocol => ({
  pathologyKey: key,
  severity,
  urgency,
  primaryTreatment: primaryVi,
  primaryTreatmentEn: primaryEn,
  followUp: followUpVi,
  followUpEn: followUpEn,
  referralNeeded: referral,
});

export const PATHOLOGY_TAXONOMY: PathologyTaxonomyItem[] = [
  // ─── DOMAIN P1: Quanh Chóp & Nha Chu ───────────────────────
  {
    key: 'periapical_radiolucency',
    domainId: 'domain_p1',
    label: 'Thấu quang quanh chóp',
    labelEn: 'Periapical Radiolucency',
    description: 'Vùng thấu quang quanh chóp răng do hoại tử tủy hoặc viêm quanh chóp mạn tính.',
    descriptionEn: 'Periapical radiolucency associated with pulp necrosis or apical periodontitis.',
    color: '#ef4444',
    fillColor: 'rgba(239,68,68,0.22)',
    protocol: mkProtocol(
      'periapical_radiolucency', 'severe', 'soon',
      'Thử sức sống tủy → Điều trị tủy (RCT) nội nha; phẫu thuật cắt chóp nếu thất bại hoặc tổn thương > 10mm.',
      'Pulp vitality test → Endodontic root canal treatment (RCT); apicoectomy if non-healing or lesion > 10mm.',
      'Chụp X-quang kiểm tra lành xương sau 6 và 12 tháng.',
      'Radiographic follow-up at 6 and 12 months.',
      true,
    ),
  },
  {
    key: 'alveolar_bone_loss',
    domainId: 'domain_p1',
    label: 'Tiêu xương ổ răng',
    labelEn: 'Alveolar Bone Loss',
    description: 'Mào xương ổ răng nằm thấp hơn đường nối men-xêmăng (CEJ) > 2mm do bệnh viêm nha chu.',
    descriptionEn: 'Alveolar crest located > 2mm below the CEJ due to periodontal disease.',
    color: '#22c55e',
    fillColor: 'rgba(34,197,94,0.22)',
    protocol: mkProtocol(
      'alveolar_bone_loss', 'moderate', 'soon',
      'Đo túi nha chu, cạo vôi và làm phẳng mặt chân răng (SRP); nha chu hỗ trợ 3 tháng/lần.',
      'Periodontal probing, scaling and root planing (SRP); supportive periodontal therapy every 3 months.',
      'Đo lại túi nha chu sau 3 tháng; kiểm tra X-quang sau 6 tháng.',
      'Re-evaluate probing depth at 3 months; radiograph at 6 months.',
    ),
  },

  // ─── DOMAIN P2: Sâu Răng & Tủy ────────────────────────────
  {
    key: 'enamel_radiolucency',
    domainId: 'domain_p2',
    label: 'Thấu quang men răng',
    labelEn: 'Enamel Radiolucency / Caries',
    description: 'Vết mất khoáng nông giới hạn trong lớp men, chưa lan qua ranh giới men-ngà (DEJ).',
    descriptionEn: 'Superficial demineralization confined strictly to enamel layer, not penetrating DEJ.',
    color: '#f59e0b',
    fillColor: 'rgba(245,158,11,0.22)',
    protocol: mkProtocol(
      'enamel_radiolucency', 'mild', 'routine',
      'Bôi Fluoride nồng độ cao (Varnish) tái khoáng hóa; hướng dẫn chỉ nha khoa hoặc trám bít phòng ngừa.',
      'Apply high-concentration topical Fluoride varnish; floss instruction or preventive resin sealant.',
      'Theo dõi và đánh giá lại sau 6 tháng.',
      'Re-evaluate after 6 months.',
    ),
  },
  {
    key: 'dentin_radiolucency',
    domainId: 'domain_p2',
    label: 'Thấu quang ngà răng',
    labelEn: 'Dentin Radiolucency / Caries',
    description: 'Tổn thương sâu răng đã vượt qua men lan vào ngà răng, có nguy cơ tiến triển vào buồng tủy.',
    descriptionEn: 'Carious lesion penetrating through enamel into dentin with risk of pulpal progression.',
    color: '#d97706',
    fillColor: 'rgba(217,119,6,0.22)',
    protocol: mkProtocol(
      'dentin_radiolucency', 'moderate', 'soon',
      'Nạo sạch ngà sâu và trám phục hồi bằng Composite/GIC; che tủy gián tiếp (IPC) nếu sâu sát tủy.',
      'Excavate carious dentin and restore with Composite/GIC; indirect pulp capping if near pulp.',
      'Kiểm tra lâm sàng và phản ứng tủy sau 6 tháng.',
      'Clinical and pulp check at 6 months.',
    ),
  },

  // ─── DOMAIN P3: Phục Hình & Cấy Ghép ────────────────────
  {
    key: 'crown_restoration',
    domainId: 'domain_p3',
    label: 'Chụp / Mão răng',
    labelEn: 'Crown Restoration',
    description: 'Mão sứ hoặc kim loại hiện diện; cần đánh giá độ khít sát bờ và tình trạng mô quanh răng.',
    descriptionEn: 'Full crown restoration present; evaluate marginal seal and periodontal health.',
    color: '#64748b',
    fillColor: 'rgba(100,116,139,0.22)',
    protocol: mkProtocol(
      'crown_restoration', 'info', 'routine',
      'Thăm dò bờ mão răng; làm lại mão nếu phát hiện hở bờ > 0.2mm hoặc sâu răng tái phát dưới bờ.',
      'Probe crown margins; replace crown if open margin > 0.2mm or secondary caries detected.',
      'Khám định kỳ hàng năm.',
      'Annual routine checkup.',
    ),
  },
  {
    key: 'filling_restoration',
    domainId: 'domain_p3',
    label: 'Miếng trám hiện có',
    labelEn: 'Filling / Restoration',
    description: 'Miếng trám Amalgam hoặc Composite hiện có; cần kiểm tra độ nguyên vẹn và đáy xoang trám.',
    descriptionEn: 'Existing amalgam or composite restoration; check for marginal breakdown or recurrent decay.',
    color: '#475569',
    fillColor: 'rgba(71,85,105,0.22)',
    protocol: mkProtocol(
      'filling_restoration', 'info', 'routine',
      'Thăm dò bờ miếng trám; trám lại nếu có hở vi kẽ, nứt vỡ hoặc sâu răng tái phát dưới đáy trám.',
      'Probe filling margins; replace filling if microleakage, fracture, or recurrent caries is present.',
      'Kiểm tra định kỳ 6-12 tháng.',
      'Routine review every 6-12 months.',
    ),
  },
  {
    key: 'root_canal_filling',
    domainId: 'domain_p3',
    label: 'Đã trám bít ống tủy',
    labelEn: 'Root Canal Filling (Gutta-percha)',
    description: 'Ống tủy đã được bít kín bằng Gutta-percha; cần đánh giá chiều dài và độ lèn kín chóp.',
    descriptionEn: 'Canal obturated with gutta-percha; evaluate obturation length and apical seal.',
    color: '#8b5cf6',
    fillColor: 'rgba(139,92,246,0.22)',
    protocol: mkProtocol(
      'root_canal_filling', 'info', 'routine',
      'Đánh giá chất lượng bít kín chóp; điều trị tủy lại (Re-RCT) nếu trám bít thiếu/quá chóp kèm tổn thương quanh chóp.',
      'Evaluate apical seal; retreatment (Re-RCT) if poorly obturated with persistent apical pathology.',
      'Chụp X-quang theo dõi hàng năm.',
      'Annual radiographic monitoring.',
    ),
  },
  {
    key: 'dental_implant',
    domainId: 'domain_p3',
    label: 'Trụ Implant nha khoa',
    labelEn: 'Dental Implant Fixture',
    description: 'Trụ implant cấy ghép trong xương ổ răng; cần đánh giá mức mào xương quanh cổ trụ.',
    descriptionEn: 'Dental implant in alveolar bone; evaluate crestal bone level around fixture collar.',
    color: '#0ea5e9',
    fillColor: 'rgba(14,165,233,0.22)',
    protocol: mkProtocol(
      'dental_implant', 'info', 'routine',
      'Đo mức mào xương quanh cổ implant; điều trị viêm quanh implant nếu tiêu xương > 2mm hoặc có thấu quang quanh trụ.',
      'Measure crestal bone level; treat peri-implantitis if bone loss > 2mm or peri-fixture radiolucency.',
      'X-quang kiểm tra hàng năm; vệ sinh quanh trụ 6 tháng/lần.',
      'Annual radiograph; implant prophylaxis every 6 months.',
    ),
  },
];

// ─── Lookup Helpers ──────────────────────────────────────────

export const PATHOLOGY_DICT: Record<string, PathologyTaxonomyItem> = Object.fromEntries(
  PATHOLOGY_TAXONOMY.map((item) => [item.key, item])
);

export const PATHOLOGY_DOMAIN_META: Record<PathologyDomainId, { label: string; labelEn: string; icon: string }> = {
  domain_p1: { label: 'Quanh Chóp & Nha Chu', labelEn: 'Periapical & Periodontal', icon: '🔴' },
  domain_p2: { label: 'Sâu Răng & Tủy', labelEn: 'Caries & Pulp', icon: '🟠' },
  domain_p3: { label: 'Phục Hình & Cấy Ghép', labelEn: 'Restorations & Implants', icon: '⚪' },
};

export function getPathologyLabel(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return key;
  return language === 'EN' ? item.labelEn : item.label;
}

export function getPathologyDescription(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return '';
  return language === 'EN' ? item.descriptionEn : item.description;
}

export function getTreatmentText(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return '';
  return language === 'EN' ? item.protocol.primaryTreatmentEn : item.protocol.primaryTreatment;
}

export const URGENCY_BADGE: Record<TreatmentProtocol['urgency'], { label: string; labelEn: string; className: string }> = {
  routine:   { label: 'Định kỳ',   labelEn: 'Routine',   className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  soon:      { label: 'Sớm',      labelEn: 'Soon',      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  urgent:    { label: 'Khẩn',     labelEn: 'Urgent',    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  emergency: { label: '🚨 Nguy Cấp', labelEn: '🚨 Emergency', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold' },
};
