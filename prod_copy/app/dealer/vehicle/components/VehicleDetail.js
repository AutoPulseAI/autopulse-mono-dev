"use client";
import { Offcanvas, Row, Col, Button, Image, Card, ListGroup, Badge, Tab, Tabs } from 'react-bootstrap';
import PhotoSlider from './PhotoSlider';

export default function VehicleDetail({ vehicle, onBack }) {
  return (
    <Offcanvas show placement="end" onHide={onBack}>
      <Offcanvas.Header closeButton className="border-bottom py-2">
        <div>
          <Offcanvas.Title>{vehicle.title}</Offcanvas.Title>
          <p className='mb-0'><small>{vehicle.stocknumber}</small></p>
        </div>
      </Offcanvas.Header>
      
      <Offcanvas.Body className="p-0">
        {/* Images */}
        {Array.isArray(vehicle.imagesSecure) && vehicle.imagesSecure.length > 0 && (
          <PhotoSlider photourls={vehicle.imagesSecure} />
        )}

        <div className='vehicle_offcanvas_tab'>
          <Tabs variant="pills" defaultActiveKey="overview" className='px-3 py-2 bg-white'>
            <Tab eventKey="overview" title="Overview">
              <div className="p-3">
                {/* Quick Facts */}
                <h3 className="w_card_title">Quick Facts</h3>
                <Row className='g-0'>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Price:</b></p></Col>
                      <Col xs={8}><p>${vehicle.customerprice}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Mileage:</b></p></Col>
                      <Col xs={8}><p>{vehicle.mileage} miles</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Exterior:</b></p></Col>
                      <Col xs={8}><p>{vehicle.exteriorcolor}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Interior:</b></p></Col>
                      <Col xs={8}><p>{vehicle.interiorcolor}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>MPG:</b></p></Col>
                      <Col xs={8}><p>{vehicle.mpgcity} city / {vehicle.mpghighway} hwy</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Engine:</b></p></Col>
                      <Col xs={8}><p>{vehicle.engine}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Transm.:</b></p></Col>
                      <Col xs={8}><p>{vehicle.transmission}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={6}>
                    <Row className='gx-1'>
                      <Col xs={4}><p><b>Drive:</b></p></Col>
                      <Col xs={8}><p>{vehicle.drive}</p></Col>
                    </Row>
                  </Col>
                </Row>

                {/* Description */}
                {vehicle.descriptionnohtml && vehicle.descriptionnohtml.trim() !== '' && (
                  <>
                    <hr className='mt-0'/>
                    <h3 className="w_card_title">Description</h3>
                    <p>{vehicle.descriptionnohtml}</p>
                  </>
                )}
              </div>
            </Tab>
            
            <Tab eventKey="features" title="Features">
              <div className="p-3">
                <h3 className="w_card_title">Features & Options</h3>
                {/* <Row className='gx-2'> */}
                  {vehicle.options?.reduce((acc, option, i) => {
                    if (i % 15 === 0) acc.push([]);
                    acc[acc.length - 1].push(option);
                    return acc;
                  }, []).map((group, i) => (
                    <Row key={i} className='gx-2'>
                      {/* <Col key={i} md={6}> */}
                          {group.map((option, j) => (
                            <Col key={j} md={12}>
                            <p className='d-inline-flex align-items-baseline'>
                              <i className="fa-regular fa-circle-dot me-2 text-custom"></i>{option}
                            </p>
                            </Col>
                          ))}
                      {/* </Col> */}
                  </Row>
                  ))}
                {/* </Row> */}
              </div>
            </Tab>
            
            <Tab eventKey="location" title="Location">
              <div className="p-3">
                {/* Dealer Information */}
                <h3 className="w_card_title">Dealer Information</h3>
                <Row className='g-0'>
                  {/*<Col xs={12}>
                    <Row className='gx-1'>
                      <Col xs={2}><p><b>Dealer:</b></p></Col>
                      <Col xs={10}><p>{vehicle.locationName}</p></Col>
                    </Row>
                  </Col>*/}
                  <Col xs={12}>
                    <Row className='gx-1'>
                      <Col xs={2}><p><b>Address:</b></p></Col>
                      <Col xs={10}><p>{vehicle.dealerstreetaddress}, {vehicle.dealercity}, {vehicle.dealerstate} {vehicle.dealerzip}</p></Col>
                    </Row>
                  </Col>
                  <Col xs={12}>
                    <Row className='gx-1'>
                      <Col xs={2}><p><b>Phone:</b></p></Col>
                      <Col xs={10}><p>{vehicle.dealerphone}</p></Col>
                    </Row>
                  </Col>
                </Row>
              </div>
            </Tab>
          </Tabs>
        </div>
        
      </Offcanvas.Body>
    </Offcanvas>
  );
}

// "use client";
// import { Offcanvas, Row, Col, Button, Image, Card, ListGroup, Badge, Tab, Tabs } from 'react-bootstrap';

// export default function VehicleDetail({ vehicle, onBack }) {
//   return (
//     <Offcanvas 
//       show 
//       placement="end" 
//       onHide={onBack}
//       style={{ width: '75vw' }} // Increased width
//     >
//       <Offcanvas.Header closeButton className="border-bottom">
//         <Offcanvas.Title className="d-flex align-items-center">
//           <Button variant="light" size="sm" onClick={onBack} className="me-2">
//             &larr;
//           </Button>
//           <div>
//             <h4 className="mb-0">{vehicle.title}</h4>
//             <small className="text-muted">{vehicle.stocknumber}</small>
//           </div>
//         </Offcanvas.Title>
//       </Offcanvas.Header>
      
//       <Offcanvas.Body className="p-0">
//         <Tabs defaultActiveKey="overview" className="mb-3 px-3">
//           <Tab eventKey="overview" title="Overview">
//             <div className="p-3">
//               <Row className="g-3 mb-4">
//                 {vehicle.imagesSecure?.slice(0, 4).map((url, i) => (
//                   <Col key={i} xs={6} md={3}>
//                     <Image src={url} fluid rounded className="w-100 h-auto" style={{ maxHeight: '150px', objectFit: 'cover' }} />
//                   </Col>
//                 ))}
//               </Row>
              
//               <Card className="mb-4">
//                 <Card.Body>
//                   <Card.Title>Quick Facts</Card.Title>
//                   <Row>
//                     <Col md={6}>
//                       <ListGroup variant="flush">
//                         <ListGroup.Item>
//                           <strong>Price:</strong> ${vehicle.customerprice}
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Mileage:</strong> {vehicle.mileage} miles
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Exterior:</strong> {vehicle.exteriorcolor}
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Interior:</strong> {vehicle.interiorcolor}
//                         </ListGroup.Item>
//                       </ListGroup>
//                     </Col>
//                     <Col md={6}>
//                       <ListGroup variant="flush">
//                         <ListGroup.Item>
//                           <strong>MPG:</strong> {vehicle.mpgcity} city / {vehicle.mpghighway} hwy
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Engine:</strong> {vehicle.engine}
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Transmission:</strong> {vehicle.transmission}
//                         </ListGroup.Item>
//                         <ListGroup.Item>
//                           <strong>Drive Type:</strong> {vehicle.drive}
//                         </ListGroup.Item>
//                       </ListGroup>
//                     </Col>
//                   </Row>
//                 </Card.Body>
//               </Card>
              
//               <Card className="mb-4">
//                 <Card.Body>
//                   <Card.Title>Description</Card.Title>
//                   <p>{vehicle.descriptionnohtml}</p>
//                 </Card.Body>
//               </Card>
//             </div>
//           </Tab>
          
//           <Tab eventKey="features" title="Features">
//             <div className="p-3">
//               <Card>
//                 <Card.Body>
//                   <Card.Title>Features & Options</Card.Title>
//                   <Row>
//                     {vehicle.options?.reduce((acc, option, i) => {
//                       if (i % 15 === 0) acc.push([]);
//                       acc[acc.length - 1].push(option);
//                       return acc;
//                     }, []).map((group, i) => (
//                       <Col key={i} md={6}>
//                         <ListGroup variant="flush">
//                           {group.map((option, j) => (
//                             <ListGroup.Item key={j}>
//                               <Badge bg="success" className="me-2">✓</Badge>
//                               {option}
//                             </ListGroup.Item>
//                           ))}
//                         </ListGroup>
//                       </Col>
//                     ))}
//                   </Row>
//                 </Card.Body>
//               </Card>
//             </div>
//           </Tab>
          
//           <Tab eventKey="location" title="Location">
//             <div className="p-3">
//               <Card>
//                 <Card.Body>
//                   <Card.Title>Dealer Information</Card.Title>
//                   <ListGroup variant="flush">
//                     <ListGroup.Item>
//                       <strong>Dealer:</strong> {vehicle.locationName}
//                     </ListGroup.Item>
//                     <ListGroup.Item>
//                       <strong>Address:</strong> {vehicle.address}, {vehicle.city}, {vehicle.state} {vehicle.zipCode}
//                     </ListGroup.Item>
//                     <ListGroup.Item>
//                       <strong>Phone:</strong> {vehicle.phoneNumber}
//                     </ListGroup.Item>
//                   </ListGroup>
//                 </Card.Body>
//               </Card>
//             </div>
//           </Tab>
//         </Tabs>
        
        
//       </Offcanvas.Body>
//     </Offcanvas>
//   );
// }