"use client";

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReportPhoto {
  id: string;
  url: string;
  caption: string | null;
  before_after_role: "before" | "after" | null;
  taken_at: string | null;
}

interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

interface CoverPageConfig {
  show_logo: boolean;
  show_company: boolean;
  show_date: boolean;
  show_photo_count: boolean;
}

interface ReportPDFProps {
  title: string;
  jobNumber: string;
  propertyAddress: string;
  claimNumber: string | null;
  insuranceCompany: string | null;
  reportDate: string;
  sections: ReportSection[];
  photos: Record<string, ReportPhoto>;
  photosPerPage: number;
  coverPage: CoverPageConfig;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const colors = {
  primary: "#1B2434",
  accent: "#C41E2A",
  blue: "#2B5EA7",
  text: "#1A1A1A",
  muted: "#666666",
  light: "#999999",
  border: "#E5E7EB",
  bg: "#F9FAFB",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    color: colors.text,
  },
  // Cover page
  coverPage: {
    fontFamily: "Helvetica",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    padding: 60,
    color: colors.text,
  },
  coverCompany: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 6,
  },
  coverSubtitle: {
    fontSize: 12,
    color: colors.accent,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    marginBottom: 40,
  },
  coverDivider: {
    width: 80,
    height: 3,
    backgroundColor: colors.accent,
    marginBottom: 40,
  },
  coverTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: colors.text,
    textAlign: "center",
    marginBottom: 30,
  },
  coverInfoBlock: {
    marginBottom: 8,
    alignItems: "center",
  },
  coverLabel: {
    fontSize: 9,
    color: colors.light,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  coverValue: {
    fontSize: 13,
    color: colors.text,
    fontFamily: "Helvetica-Bold",
  },
  // Section header
  sectionHeader: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },
  sectionDescription: {
    fontSize: 9,
    color: "#CBD5E1",
    marginTop: 3,
  },
  // Photo grids
  photoRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  photoContainer: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  photoImage: {
    width: "100%",
    objectFit: "cover",
  },
  photoCaption: {
    padding: 6,
    backgroundColor: colors.bg,
  },
  photoCaptionText: {
    fontSize: 8,
    color: colors.text,
  },
  photoBadge: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 2,
    marginTop: 3,
    alignSelf: "flex-start",
  },
  beforeBadge: {
    backgroundColor: "#FCEBEB",
    color: "#791F1F",
  },
  afterBadge: {
    backgroundColor: "#E1F5EE",
    color: "#085041",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: colors.light,
  },
  footerPage: {
    fontSize: 7,
    color: colors.muted,
    fontFamily: "Helvetica-Bold",
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function getPhotoHeight(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 480;
    case 2:
      return 230;
    case 4:
      return 210;
    case 6:
      return 140;
    default:
      return 230;
  }
}

function getGridCols(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 1;
    case 2:
      return 1;
    case 4:
      return 2;
    case 6:
      return 2;
    default:
      return 1;
  }
}

function getRowsPerPage(photosPerPage: number): number {
  switch (photosPerPage) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 4:
      return 2;
    case 6:
      return 3;
    default:
      return 2;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ─── Components ──────────────────────────────────────────────────────────────

function PageFooter({ title }: { title: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        AAA Disaster Recovery — {title}
      </Text>
      <Text
        style={styles.footerPage}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

function PhotoCard({
  photo,
  height,
}: {
  photo: ReportPhoto;
  height: number;
}) {
  return (
    <View style={styles.photoContainer}>
      <Image src={photo.url} style={[styles.photoImage, { height }]} />
      <View style={styles.photoCaption}>
        {photo.caption && (
          <Text style={styles.photoCaptionText}>{photo.caption}</Text>
        )}
        {photo.before_after_role && (
          <Text
            style={[
              styles.photoBadge,
              photo.before_after_role === "before"
                ? styles.beforeBadge
                : styles.afterBadge,
            ]}
          >
            {photo.before_after_role === "before" ? "BEFORE" : "AFTER"}
          </Text>
        )}
        {!photo.caption && !photo.before_after_role && (
          <Text style={[styles.photoCaptionText, { color: colors.light }]}>
            No caption
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Main Document ───────────────────────────────────────────────────────────

export default function ReportPDFDocument({
  title,
  jobNumber,
  propertyAddress,
  claimNumber,
  insuranceCompany,
  reportDate,
  sections,
  photos,
  photosPerPage,
  coverPage,
}: ReportPDFProps) {
  const totalPhotos = sections.reduce(
    (sum, s) => sum + s.photo_ids.length,
    0
  );
  const photoHeight = getPhotoHeight(photosPerPage);
  const gridCols = getGridCols(photosPerPage);

  return (
    <Document title={title} author="AAA Disaster Recovery">
      {/* ═══ COVER PAGE ═══ */}
      <Page size="LETTER" style={styles.coverPage}>
        {coverPage.show_company && (
          <>
            <Text style={styles.coverCompany}>AAA Disaster Recovery</Text>
            <Text style={styles.coverSubtitle}>PHOTO REPORT</Text>
          </>
        )}

        <View style={styles.coverDivider} />

        <Text style={styles.coverTitle}>{title}</Text>

        <View style={styles.coverInfoBlock}>
          <Text style={styles.coverLabel}>Job Number</Text>
          <Text style={styles.coverValue}>{jobNumber}</Text>
        </View>

        <View style={styles.coverInfoBlock}>
          <Text style={styles.coverLabel}>Property Address</Text>
          <Text style={styles.coverValue}>{propertyAddress}</Text>
        </View>

        {claimNumber && (
          <View style={styles.coverInfoBlock}>
            <Text style={styles.coverLabel}>Claim Number</Text>
            <Text style={styles.coverValue}>{claimNumber}</Text>
          </View>
        )}

        {insuranceCompany && (
          <View style={styles.coverInfoBlock}>
            <Text style={styles.coverLabel}>Insurance Company</Text>
            <Text style={styles.coverValue}>{insuranceCompany}</Text>
          </View>
        )}

        {coverPage.show_date && (
          <View style={[styles.coverInfoBlock, { marginTop: 20 }]}>
            <Text style={styles.coverLabel}>Report Date</Text>
            <Text style={styles.coverValue}>{formatDate(reportDate)}</Text>
          </View>
        )}

        {coverPage.show_photo_count && (
          <View style={styles.coverInfoBlock}>
            <Text style={styles.coverLabel}>Total Photos</Text>
            <Text style={styles.coverValue}>{totalPhotos}</Text>
          </View>
        )}

        <PageFooter title={title} />
      </Page>

      {/* ═══ SECTION PAGES ═══ */}
      {sections.map((section, si) => {
        const sectionPhotos = section.photo_ids
          .map((id) => photos[id])
          .filter(Boolean);

        if (sectionPhotos.length === 0) return null;

        // Chunk photos into rows, then rows into pages
        const rows = chunkArray(sectionPhotos, gridCols);
        const rowsPerPage = getRowsPerPage(photosPerPage);
        const pages = chunkArray(rows, rowsPerPage);

        return pages.map((pageRows, pi) => (
          <Page key={`s${si}-p${pi}`} size="LETTER" style={styles.page}>
            {/* Show section header on first page of each section */}
            {pi === 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {si + 1}. {section.title}
                </Text>
                {section.description && (
                  <Text style={styles.sectionDescription}>
                    {section.description}
                  </Text>
                )}
              </View>
            )}

            {/* Photo rows */}
            {pageRows.map((row, ri) => (
              <View key={ri} style={styles.photoRow}>
                {row.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    height={photoHeight}
                  />
                ))}
                {/* Fill empty cells to maintain layout */}
                {row.length < gridCols &&
                  Array.from({ length: gridCols - row.length }).map((_, i) => (
                    <View key={`empty-${i}`} style={{ flex: 1 }} />
                  ))}
              </View>
            ))}

            <PageFooter title={title} />
          </Page>
        ));
      })}
    </Document>
  );
}
