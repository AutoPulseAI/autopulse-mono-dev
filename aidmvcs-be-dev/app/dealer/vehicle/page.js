// pages/vehicles/page.js
"use client";
import { useState } from 'react';
import VehicleList from './components/VehicleList';
import VehicleDetail from './components/VehicleDetail';
import { useUser } from '../context/UserContext';

export default function VehicleManagement() {
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent ;

  // Wait until dealerParent (or user) id is loaded
  if (!activeEntity || !activeEntity.id) {
    return (
      <div className="page_content">
        <div className="page_head">
          <h3 className="page_title">Vehicles</h3>
        </div>
        <div className="page_body">
          <p>Loading dealer information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page_content">
      <div className="page_head">
        <h3 className="page_title mb-0">Vehicles</h3>
      </div>
      <div className="page_body">
        {/* Always render VehicleList */}
        <VehicleList
          dealerId={activeEntity.id}
          onSelect={setSelectedVehicle} 
        />

        {/* Conditionally render Offcanvas (it overlays without unmounting list) */}
        {selectedVehicle && (
          <VehicleDetail
            vehicle={selectedVehicle}
            onBack={() => setSelectedVehicle(null)}
          />
        )}
      </div>
    </div>

    // <div className="page_content">
    //   <div className="page_head">
    //     <h3 className="page_title">Vehicles</h3>
    //   </div>
    //   <div className="page_body">
    //     {selectedVehicle ? (
    //       <VehicleDetail
    //         vehicle={selectedVehicle}
    //         onBack={() => setSelectedVehicle(null)}
    //       />
    //     ) : (
    //       <VehicleList
    //         dealerId={activeEntity.id}
    //         onSelect={setSelectedVehicle}
    //       />
    //     )}
    //   </div>
    // </div>
  );
}