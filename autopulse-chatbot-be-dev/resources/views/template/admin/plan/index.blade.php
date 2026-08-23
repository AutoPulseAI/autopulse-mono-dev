@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">

<div class="position-relative">
    <div class="row gx-2">
        <div class="col col-md-12 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Manage Plans</h2>
            </div>
        </div>
    </div>

    <div class="tab_box">
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" id="planlistall" href="#plansList">All Plans</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" href="#plansForm">Add Plan</a>
            </li>
        </ul>

        <div class="tab-content">
            <div id="plansList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="plan_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>Plan Name</td>
                                <td>Description</td>
                                <td>Price</td>
                                <td>Interval</td>
                                <td>Stripe Plan ID</td>
                                <td>Created At</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach($plan as $key => $value)
                                <tr>
                                    <td>{{ $value->id }}</td>
                                    <td>{{ $value->name }}</td>
                                    <td>{{ Str::limit($value->description, 50) }}</td>
                                    <td>${{ number_format($value->price, 2) }}</td>
                                    <td>{{ ucfirst($value->interval) }}</td>
                                    <td>{{ $value->stripe_plan_id }}</td>
                                    <td>{{ $value->created_at->format('M d, Y') }}</td>
                                    <td>
                                        <div class="table_action dropdown">
                                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                                            <ul class="dropdown-menu">
                                                <li><a class="dropdown-item editDealer" onclick="setEditData('{{ $value->id }}', '{{ $value->name }}', `{{ $value->description }}`, '{{ $value->price }}', '{{ $value->interval }}')" data-bs-toggle="modal" data-bs-target="#editPlan">Edit</a></li>
                                                <li><a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('{{ route('admin.plan.delete',['plan_id'=>$value->id]) }}')">Delete</a></li>
                                            </ul>
                                        </div>
                                    </td> 
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="plansForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3 mx-md-3 mx-0">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <form id="addplan" class="gx-3 gy-2" method="POST" action="{{ route('admin.plan.add') }}">
                                @csrf
                                <div class="tab_box_form border bg-transparent rounded">
                                    <div class="row gx-2">
                                        <div class="col col-12">
                                            <input type="text" class="form-control" id="name" name="name" placeholder="Plan Name" value="" required>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <input type="number" step="0.01" class="form-control" id="price" name="price" placeholder="Price (e.g. 9.99)" required>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <select class="form-select w-100" id="interval" name="interval" required>
                                                <option>Select Billing Interval</option>
                                                <option value="day">Daily</option>
                                                <option value="month">Monthly</option>
                                                <option value="quater">Quarterly</option>
                                                <option value="year">Yearly</option>
                                            </select>
                                        </div>
                                        <div class="col col-md-12 col-12 mb-3">
                                            <label for="description" class="form-label">Description</label>
                                            <textarea class="form-control" id="description" name="description" rows="6" placeholder="Enter plan description..."></textarea>
                                        </div>
                                    </div>
                                </div>
                                <div class="row justify-content-center">
                                    <div class="col col-lg-2 col-md-3 col-12">
                                        <div class="position-relative text-center mt-3">
                                            <button type="submit" class="btn btn_theme w-100">Submit</button> 
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>

                <!-- <div class="row">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="card-title mb-0">Add New Plan</h5>
                            </div>
                            <div class="card-body">
                                <form id="addplan" method="POST" action="{{ route('admin.plan.add') }}">
                                    @csrf
                                    
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="mb-3">
                                                <label for="name" class="form-label">Plan Name <span class="text-danger">*</span></label>
                                                <input type="text" class="form-control" id="name" name="name" value="" required>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="mb-3">
                                                <label for="price" class="form-label">Price <span class="text-danger">*</span></label>
                                                <input type="number" step="0.01" class="form-control" id="price" name="price" placeholder="9.99" required>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="mb-3">
                                                <label for="interval" class="form-label">Billing Interval <span class="text-danger">*</span></label>
                                                <select class="form-control" id="interval" name="interval" required>
                                                    <option value="">Select Billing Interval</option>
                                                    <option value="month">Monthly</option>
                                                    <option value="day">Daily</option>
                                                    <option value="quater">Quarterly</option>
                                                    <option value="year">Yearly</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="mb-3">
                                        <label for="description" class="form-label">Description</label>
                                        <textarea class="form-control" id="description" name="description" rows="6" placeholder="Enter plan description..."></textarea>
                                    </div>
                                    
                                    <div class="d-flex justify-content-end">
                                        <button type="submit" class="btn btn-primary">
                                            <i class="fa-light fa-plus"></i> Create Plan
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div> -->
            </div>
        </div>
    </div>
</div>
       


<!-- Edit Plan -->
<div class="modal fade" id="editPlan" tabindex="-1" aria-labelledby="editPlanLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="editPlanLabel">
                    <i class="fa-light fa-pen me-2"></i>Edit Plan
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <!-- Edit Plan Form -->
                <div class="alert alert-info mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    <strong>Note:</strong> Only name and description can be edited. Price and interval cannot be changed after plan creation due to Stripe integration.
                </div>
                <form id="editPlanForm" method="POST" action="{{ route('admin.plan.update')}}">
                    @csrf
                    <input type="hidden" id="editPlanId" name="id">

                    <div class="row">
                        <div class="col-md-6">
                            <div class="mb-3">
                                <label for="editName" class="form-label">Plan Name <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" id="editName" name="name" required>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="mb-3">
                                <label for="editPrice" class="form-label">Price <span class="text-secondary">(Read Only)</span></label>
                                <input type="text" class="form-control" id="editPrice" name="price" placeholder="9.99" readonly disabled style="background-color: #f8f9fa;">
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6">
                            <div class="mb-3">
                                <label for="editInterval" class="form-label">Billing Interval <span class="text-secondary">(Read Only)</span></label>
                                <select class="form-control" id="editInterval" name="interval" disabled style="background-color: #f8f9fa;">
                                    <option value="day">Daily</option>
                                    <option value="month">Monthly</option>
                                    <option value="quater">Quarterly</option>
                                    <option value="year">Yearly</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="mb-3">
                        <label for="editDescription" class="form-label">Description</label>
                        <textarea class="form-control" id="editDescription" name="description" rows="6" placeholder="Enter plan description..."></textarea>
                    </div>

                    <div class="row justify-content-center gx-2">
                        <div class="col col-lg-3 col-6">
                            <button type="button" data-bs-dismiss="modal" class="btn btn-outline-primary w-100 mt-3">Cancel</button>
                        </div>
                        <div class="col col-lg-3 col-6">
                            <button type="submit" class="btn btn_theme w-100 mt-3">Update Plan</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>

<!-- Delete -->
<div  class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-light fa-circle-xmark fa-3x mb-3 text-white"></i>
                    <h5 class="mb-4">Are you sure? You want to delete?</h5>
                    <div class="position-relative text-center">
                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-3 col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-lg-3 col-6">
                                <button type="button" class="btn btn_theme w-100" onclick="actionmethod()">Yes</button> 
                            </div> 
                        </div> 
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Approve -->
<div  class="modal fade" id="approve" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
        <div class="modal-header border-0">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body pb-4">
            <div class="position-relative text-center">
                <i class="fa-regular fa-circle-check mb-3 text-success"></i>
                <h5 class="mb-4">Are you sure? You want to Approve?</h5>
                <div class="position-relative text-center">                 
                    <button  type="button" class="btn btn-success" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>


   
@endsection
@section('script')
<script src="https://cdn.ckeditor.com/4.16.2/standard/ckeditor.js"></script>
<style>
/* Dark mode for CKEditor */
.cke_chrome {
    background-color: var(--dark-light) !important;
    color: var(--gray) !important;
    border: 1px solid var(--border) !important;
    border-radius: 0.375rem !important;
}

.cke_top {
  background-color: var(--dark-light) !important;
  border-bottom: 1px solid var(--border) !important;
}

.cke_bottom {
  background-color: var(--dark-light) !important;
  border-top: 1px solid var(--border) !important;
}

.cke_editable {
  background-color: var(--dark-light) !important;
  color: var(--gray) !important;
  min-height: 150px !important;
  border: none !important;
  padding: 0.75rem !important;
}

.cke_button__bold_icon,
.cke_button__italic_icon,
.cke_button__underline_icon,
.cke_button__link_icon,
.cke_button__unlink_icon,
.cke_button__numberedlist_icon,
.cke_button__bulletedlist_icon,
.cke_button__blockquote_icon {
  filter: invert(1) !important;
}

/* Adjust placeholder and scrollbar */
.cke_editable::placeholder {
  color: #bbb !important;
}
.cke_contents::-webkit-scrollbar {
  width: 6px;
}
.cke_contents::-webkit-scrollbar-thumb {
  background-color: #555;
  border-radius: 10px;
}
</style>
<script>
function setEditData(id, name, description, price, interval) {
    $('#editPlanId').val(id);
    $('#editName').val(name);
    $('#editPrice').val(price);
    $('#editInterval').val(interval);

    // Set CKEditor content
    if (CKEDITOR.instances['editDescription']) {
        CKEDITOR.instances['editDescription'].setData(description);
    }

    // Add visual indicators for disabled fields
    $('#editPrice').attr('title', 'Price cannot be changed after plan creation');
    $('#editInterval').attr('title', 'Interval cannot be changed after plan creation');
}

// Initialize CKEditor
$(document).ready(function() {
    // Wait for CKEditor to be available
    if (typeof CKEDITOR !== 'undefined') {
        // Initialize CKEditor for add plan form
        CKEDITOR.replace('description', {
            height: 200,
            toolbar: [
                { name: 'basicstyles', items: ['Bold', 'Italic', 'Underline', 'Strike'] },
                { name: 'paragraph', items: ['NumberedList', 'BulletedList', '-', 'Outdent', 'Indent'] },
                { name: 'links', items: ['Link', 'Unlink'] },
                { name: 'insert', items: ['Image', 'Table', 'HorizontalRule'] },
                { name: 'styles', items: ['Format', 'Font', 'FontSize'] },
                { name: 'colors', items: ['TextColor', 'BGColor'] },
                { name: 'tools', items: ['Maximize', 'Source'] }
            ]
        });
        
        // Initialize CKEditor for edit plan modal
        CKEDITOR.replace('editDescription', {
            height: 200,
            toolbar: [
                { name: 'basicstyles', items: ['Bold', 'Italic', 'Underline', 'Strike'] },
                { name: 'paragraph', items: ['NumberedList', 'BulletedList', '-', 'Outdent', 'Indent'] },
                { name: 'links', items: ['Link', 'Unlink'] },
                { name: 'insert', items: ['Image', 'Table', 'HorizontalRule'] },
                { name: 'styles', items: ['Format', 'Font', 'FontSize'] },
                { name: 'colors', items: ['TextColor', 'BGColor'] },
                { name: 'tools', items: ['Maximize', 'Source'] }
            ]
        });
    } else {
        console.error('CKEditor not loaded');
        // Ensure textareas are visible as fallback
        $('#description, #editDescription').show();
    }
});

// Initialize DataTable
var planTable = $('#plan_tabl').DataTable({
    responsive: true,
    pageLength: 10,
    order: [[0, 'desc']],
    columnDefs: [
        { orderable: false, targets: -1 } // Disable ordering on action column
    ]
});

// Add Plan Form
$('#addplan').on('submit', function (event) {
    event.preventDefault();
    
    if ($(this)[0].checkValidity()) {
        // Update CKEditor content before form submission
        for (instance in CKEDITOR.instances) {
            CKEDITOR.instances[instance].updateElement();
        }
        
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).html('<i class="fa-light fa-spinner fa-spin me-1"></i>Creating...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');
        
        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).html('<i class="fa-light fa-plus"></i> Create Plan');
            
            if (output.success) {
                // Show success message
                showAlert('success', 'Plan created successfully!');
                
                // Reset form and CKEditor
                $('#addplan')[0].reset();
                CKEDITOR.instances['description'].setData('');
                
                // Reload table
                planTable.ajax.reload();
                
                // Switch to plans list tab
                $('#planlistall').tab('show');
            } else {
                showAlert('error', output.message || 'Failed to create plan');
            }
        });
    }
});

// Edit Plan Form
$('#editPlanForm').on('submit', function (event) {
    event.preventDefault();
    
    if ($(this)[0].checkValidity()) {
        // Update CKEditor content before form submission
        for (instance in CKEDITOR.instances) {
            CKEDITOR.instances[instance].updateElement();
        }
        
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).html('<i class="fa-light fa-spinner fa-spin me-1"></i>Updating...');
        
        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function (output) {
            submitButton.prop('disabled', false).html('<i class="fa-light fa-save me-1"></i>Update Plan');
            
            if (output.success) {
                // Show success message
                showAlert('success', 'Plan updated successfully!');
                
                // Close modal
                $('#editPlan').modal('hide');
                
                // Reload table
                planTable.ajax.reload();
            } else {
                showAlert('error', output.message || 'Failed to update plan');
            }
        });
    }
});

// Delete Plan
function actionmethod() {
    var actionsurl = $('#seturl').val();
    
    runajax(actionsurl, '', 'get', '', 'json', function(output) {
        console.log(output);
        if (output.success) {
            $('.modal').modal('hide');
            showAlert('success', 'Plan deleted successfully!');
            planTable.ajax.reload();
        } else {
            showAlert('error', output.message || 'Failed to delete plan');
        }
    }); 
}

function seturl(url) {
    $('#seturl').val(url);
}

// Alert function
function showAlert(type, message) {
    var alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
    var alertHtml = '<div class="alert ' + alertClass + ' alert-dismissible fade show" role="alert">' +
                    message +
                    '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>' +
                    '</div>';
    
    // Remove existing alerts
    $('.alert').remove();
    
    // Add new alert
    $('.page_title').after(alertHtml);
    
    // Auto remove after 5 seconds
    setTimeout(function() {
        $('.alert').fadeOut();
    }, 5000);
}

// Tab switching
$('a[data-bs-toggle="pill"]').on('shown.bs.tab', function (e) {
    var target = $(e.target).attr("href");
    if (target === '#plansList') {
        planTable.columns.adjust().responsive.recalc();
    }
});
</script>
@endsection
