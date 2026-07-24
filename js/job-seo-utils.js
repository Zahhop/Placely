(function () {
  function text(value) {
    return String(value || "").trim();
  }

  function stripMarkup(value) {
    return text(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function mapJobToSeoData(job, companyProfile = {}) {
    const title = text(job?.job_title || job?.title || "Job opportunity");
    const description = stripMarkup(job?.job_description || job?.description || "");
    const organization = text(job?.company_name || job?.company || companyProfile.company_name || "Placely employer");
    const location = text(job?.location || "");
    const compensationType = text(job?.compensation_type || "");
    const min = Number(job?.compensation_min);
    const max = Number(job?.compensation_max);
    const hasSalary = Number.isFinite(min) && min > 0;

    const seo = {
      title,
      description,
      datePosted: job?.created_at || null,
      validThrough: job?.application_deadline || null,
      employmentType: text(job?.employment_type || ""),
      hiringOrganization: organization,
      jobLocation: location,
      identifier: text(job?.id || ""),
      directApply: true
    };

    if (hasSalary) {
      seo.baseSalary = {
        currency: "CAD",
        value: {
          minValue: min,
          unitText: compensationType || "JOB"
        }
      };

      if (Number.isFinite(max) && max >= min) {
        seo.baseSalary.value.maxValue = max;
      }
    }

    return seo;
  }

  function buildJobPostingJsonLd(job, companyProfile = {}) {
    const seo = mapJobToSeoData(job, companyProfile);
    const data = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: seo.title,
      description: seo.description,
      datePosted: seo.datePosted,
      employmentType: seo.employmentType || undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: seo.hiringOrganization
      },
      identifier: {
        "@type": "PropertyValue",
        name: "Placely Talent",
        value: seo.identifier
      },
      directApply: seo.directApply
    };

    if (seo.validThrough) data.validThrough = seo.validThrough;
    if (seo.jobLocation) {
      data.jobLocation = {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: seo.jobLocation,
          addressCountry: "CA"
        }
      };
    }
    if (seo.baseSalary) data.baseSalary = seo.baseSalary;

    return removeEmpty(data);
  }

  function removeEmpty(value) {
    if (Array.isArray(value)) return value.map(removeEmpty).filter(Boolean);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
        .map(([key, entry]) => [key, removeEmpty(entry)])
    );
  }

  window.PlacelyJobSeo = {
    buildJobPostingJsonLd,
    mapJobToSeoData
  };
})();
