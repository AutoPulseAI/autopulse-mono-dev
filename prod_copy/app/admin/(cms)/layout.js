"use client";

import CmsNav from "../components/CmsNav";

export default function CmsLayout({ children }) {
  return (
    <div className="cms-layout">
      <div className="cms-layout__header">
        <div>
          <h3 className="cms-layout__title mb-1">Website CMS</h3>
          <p className="cms-layout__subtitle mb-0">Manage pages, navigation, and site-wide settings</p>
        </div>
        <CmsNav />
      </div>
      {children}
    </div>
  );
}
