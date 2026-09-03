'use client';

import { useState } from 'react';
import { Card, Form, Button, Row, Col, InputGroup } from 'react-bootstrap';

export default function RuleEditor({ rule, statusOptions, onUpdate, onDelete }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleChange = (field, value) => {
    onUpdate(rule.id, { [field]: value });
  };

  return (
    <>
      <div className="followup_rule">
        <div className="position-relative d-flex align-items-center">
          <Form.Check
            type="switch"
            id={`rule-active-${rule.id}`}
            checked={rule.active}
            onChange={e => handleChange('active', e.target.checked)}
            className="me-2"
          />
          <p className="mb-0 me-auto"><b>Lead follow-up if status is <span className='text-custom'>{rule.leadStatus || 'Not set'}</span></b></p>
          <Button variant="link" size="sm" onClick={() => setIsExpanded(v => !v)} className="ms-2 close_sm text-custom">
            {isExpanded ? <i className="fa-solid fa-chevron-up"></i> : <i className="fa-solid fa-chevron-down"></i>}
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="ms-2 close_sm"
            onClick={() => onDelete(rule.id)}
          ><i className="fa-solid fa-xmark"></i></Button>
        </div>

        {isExpanded && (
          <Form as={Row} className='mt-2 gx-md-3 g-1'>
            {/* Lead Status */}
            <Form.Group as={Col} lg={6} md={4} xs={12}>
              <Form.Label className="mb-1"><small>Conversation Status</small></Form.Label>
              <Form.Select
                value={rule.leadStatus || ''}
                onChange={e => handleChange('leadStatus', e.target.value)}
                size='sm'
              >
                <option value="">Select status</option>
                {statusOptions.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            {/* Interval */}
            <Form.Group as={Col} lg={3} md={4} xs={6}>
              <Form.Label className="mb-1"><small>Interval by Days</small></Form.Label>
              <InputGroup size="sm">
                <Button
                  variant="custom"
                  onClick={() => handleChange('frequencyValue', Math.max(1, rule.frequencyValue - 1))}
                  size='sm'
                ><i className="fa-regular fa-minus"></i></Button>
                <Form.Control
                  type="number"
                  min={1}
                  value={rule.frequencyValue}
                  onChange={e =>
                    handleChange('frequencyValue', parseInt(e.target.value, 10) || 1)
                  }
                  placeholder="Enter number of days"
                  className='text-center'
                  size='sm'
                />
                <Button
                  variant="custom"
                  onClick={() => handleChange('frequencyValue', rule.frequencyValue + 1)}
                  size='sm'
                ><i className="fa-regular fa-plus"></i></Button>
              </InputGroup>
            </Form.Group>

            {/* Stop After */}
            <Form.Group as={Col} lg={3} md={4} xs={6}>
              <Form.Label className="mb-1"><small>Stop Follow-ups Days</small></Form.Label>
              <InputGroup size="sm">
                <Button
                  variant="custom"
                  onClick={() => handleChange('stopAfter', Math.max(0, rule.stopAfter - 1))}
                  size='sm'
                ><i className="fa-regular fa-minus"></i></Button>
                <Form.Control
                  type="number"
                  min={0}
                  value={rule.stopAfter || 0}
                  onChange={e =>
                    handleChange('stopAfter', parseInt(e.target.value, 10) || 0)
                  }
                  placeholder="Enter max days"
                  className='text-center'
                  size='sm'
                />
                <Button
                  variant="custom"
                  onClick={() => handleChange('stopAfter', (rule.stopAfter || 0) + 1)}
                  size='sm'
                ><i className="fa-regular fa-plus"></i></Button>
              </InputGroup>
            </Form.Group>
          </Form>
        )}
      </div>
    </>
  );
}
