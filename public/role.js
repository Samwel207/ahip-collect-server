// AHIP Manage roles in the page: supervisors see the home page and Forms only (the server enforces it too).
"use strict";
window.AHIP_ROLE = {
  apply(user) {
    if (!user || user.role === "admin") return;
    document.querySelectorAll('.tabs a[href="#users"], .tabs a[href="#settings"], .tabs a[href="fhir.html"]').forEach((a) => a.remove());
    document.body.classList.add("role-supervisor");
  },
};
