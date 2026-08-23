"use client";
import { useState, useEffect } from 'react';
import { ListGroup, Row, Col, Button, Form, Alert } from 'react-bootstrap';
import Pagination from './Pagination';

export default function VehicleList({ initialDealerId, onSelect }) {
  const [vehicles, setVehicles] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [input, setInput] = useState({ 
    vin: '', 
    stock: '', 
    make: '', 
    model: '', 
    year: '',
    dealerId: initialDealerId || ''
  });
  const [filters, setFilters] = useState({ 
    vin: '', 
    stock: '', 
    make: '', 
    model: '', 
    year: '',
    dealerId: initialDealerId || ''
  });
  const [pagination, setPagination] = useState({ 
    currentPage: 1, 
    totalPages: 1, 
    itemsPerPage: 10, 
    hasNextPage: false, 
    hasPreviousPage: false 
  });
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    fetchVehicles();
  }, [pagination.currentPage, filters]);

  const fetchVehicles = async () => {
    setLoading(true);
    let query = `page=${pagination.currentPage}&limit=${pagination.itemsPerPage}`;
    
    if (filters.dealerId) query += `&dealer_id=${encodeURIComponent(filters.dealerId)}`;
    if (filters.vin) query += `&vin=${encodeURIComponent(filters.vin)}`;
    if (filters.stock) query += `&stock=${encodeURIComponent(filters.stock)}`;
    if (filters.make) query += `&make=${encodeURIComponent(filters.make)}`;
    if (filters.model) query += `&model=${encodeURIComponent(filters.model)}`;
    if (filters.year) query += `&year=${encodeURIComponent(filters.year)}`;

    try {
      const res = await fetch(`/api/vehicles?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch vehicles');

      setVehicles(data.data);
      setDealers(data.dealers || []);
      setPagination(prev => ({
        ...prev,
        currentPage: data.pagination.currentPage,
        totalPages: data.pagination.totalPages,
        hasNextPage: data.pagination.hasNextPage,
        hasPreviousPage: data.pagination.hasPreviousPage
      }));
    } catch (err) {
      setAlert({ type: 'danger', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleInput = e => setInput(prev => ({ ...prev, [e.target.name]: e.target.value }));
  
  const handleSearch = () => {
    setFilters(input);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };
  
  const handleReset = () => {
    const empty = { vin: '', stock: '', make: '', model: '', year: '', dealerId: initialDealerId || '' };
    setInput(empty);
    setFilters(empty);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };
  
  const handlePageChange = page => {
    if (page < 1 || page > pagination.totalPages) return;
    setPagination(prev => ({ ...prev, currentPage: page }));
  };

  return (
    <>
      {alert && <Alert variant={alert.type}>{alert.message}</Alert>}

      <div className="w_card">
        <Row className="align-items-center">
          <Col xxl={1} lg={2} xs={12}>
            <div className="d-flex align-items-center mb-lg-0 mb-2">
              <h3 className="w_card_title mb-0">Vehicles List</h3>
            </div>
          </Col>
          <Col xxl={11} lg={10} xs={12}>
            {/* Filter Controls */}
            <Form>
              <Row className="search_filters gx-1 gy-md-0 gy-1">
                <Col md={2} xs={6}>
                  <Form.Select 
                    name="dealerId" 
                    value={input.dealerId} 
                    onChange={handleInput}
                    size="sm"
                    className='w-100'
                  >
                    <option value="">All Dealers</option>
                    {dealers.map(dealer => (
                      <option key={dealer._id} value={dealer._id}>
                        {dealer.name}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col md={2} xs={6}>
                  <Form.Control name="vin" placeholder="VIN" value={input.vin} onChange={handleInput} size="sm" />
                </Col>
                <Col md={2} xs={6}>
                  <Form.Control name="stock" placeholder="Stock #" value={input.stock} onChange={handleInput} size="sm" />
                </Col>
                <Col md={2} xs={6}>
                  <Form.Control name="make" placeholder="Make" value={input.make} onChange={handleInput} size="sm" />
                </Col>
                <Col md={2} xs={6}>
                  <Form.Control name="model" placeholder="Model" value={input.model} onChange={handleInput} size="sm" />
                </Col>
                <Col md={1} xs={6}>
                  <Form.Control name="year" placeholder="Year" value={input.year} onChange={handleInput} size="sm" />
                </Col>
                <Col md={1} xs={12}>
                  <div className="d-flex gap-1">
                    <Button variant="custom" onClick={handleSearch} size="sm" className="w-50">Search</Button>
                    <Button variant="secondary" onClick={handleReset} size="sm" className="w-50">Clear</Button>
                  </div>
                </Col>
              </Row>
            </Form>
          </Col>
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center g-0">
                <Col xl={11} lg={10} sm={10} xs={9}>
                  <Row className="align-items-center gx-2">
                    <Col xl={3} lg={3} sm={3} xs={12}><p className="p_bold"><small>Dealer</small></p></Col>
                    <Col xl={3} lg={3} sm={3} xs={12}><p className="p_bold"><small>VIN</small></p></Col>
                    <Col xl={2} lg={2} sm={2} xs={12}><p className="p_bold"><small>Stock #</small></p></Col>
                    <Col xl={2} lg={2} sm={2} xs={12}><p className="p_bold"><small>Make</small></p></Col>
                    <Col xl={2} lg={2} sm={2} xs={12}><p className="p_bold"><small>Model</small></p></Col>
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={3}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>
            
            {vehicles.length > 0 ? vehicles.map(v => (
              <ListGroup.Item as="li" key={v._id} className="w_card_list_box">
                <Row className="align-items-md-center g-0">
                  <Col xl={11} lg={11} sm={11} xs={9} onClick={() => onSelect(v)} className="a_link">
                    <Row className="align-items-center gx-2">
                      <Col xl={3} lg={3} sm={3} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Dealer:</small></p>
                          <p className="p_bold">{v.dealerId?.name || 'N/A'}</p>
                        </div>
                      </Col>
                      <Col xl={3} lg={3} sm={3} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>VIN:</small></p>
                          <p>{v.vin || "N/A"}</p>
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Stock #:</small></p>
                          <p>{v.stocknumber || "N/A"}</p>
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Make:</small></p>
                          <p>{v.make || "N/A"}</p>
                        </div>
                      </Col>
                      <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Model:</small></p>
                          <p>{v.model || "N/A"}</p>
                        </div>
                      </Col>
                    </Row>
                  </Col>

                  <Col xl={1} lg={1} sm={1} xs={3}>
                    <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                      <Button variant="custom" size="sm" onClick={() => onSelect(v)}>
                        <i className="fa-regular fa-eye"></i>
                      </Button>
                    </div>
                  </Col>
                </Row>
              </ListGroup.Item>
            )) : (
              <div className="text-center py-4">{loading ? 'Loading...' : 'No vehicles found.'}</div>
            )}
          </ListGroup>

          {pagination.totalPages > 1 && (
            <Pagination 
              currentPage={pagination.currentPage} 
              setCurrentPage={handlePageChange} 
              totalPages={pagination.totalPages} 
            />
          )}
        </div>
      </div>
    </>
  );
}
