@extends('layouts.admin')

@section('content')
<input type="hidden" id="seturl" value="">
<div class="position-relative">
    <div class="row">
        <div class="col col-md-4 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Manage Employees</h2>
            </div>
        </div>
        <div class="col col-md-8 col-12">
            <div class="position-relative">
                <!--form class="row gx-1 justify-content-md-end">
                    <div class="col col-md-4 col-12">
                        <div class="position-relative">
                            <select class="form-select w-100" id="multiempselect" multiple>
                                <option>Select Assigned Role</option>
                                <option value="1">One</option>
                                <option value="2">Two</option>
                                <option value="3">Three</option>
                            </select>
                        </div>                        
                    </div>
                   
                    <div class="col col-md-2 col-6">
                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                    </div>
                    <div class="col col-md-2 col-6">
                        <a href="{{ route('dealer.myvehicle') }}" class="btn btn_theme w-100" >Reset</a>
                    </div>
                </form-->
            </div>
        </div>
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10" data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <!-- Nav pills -->
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" href="#employeesList">All Employees</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" href="#employeesForm">Add Employee</a>
            </li>
        </ul>

        <!-- Tab panes -->
        <div class="tab-content">
            <!-- All Employees -->
            <div id="employeesList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="page_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>Name</td>
                                <td>Email</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>

            <!-- Employee Form Tab -->
            <div id="employeesForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3 mx-md-3 mx-0">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <form id="addStaffForm" class="gx-3 gy-2" method="POST" action="{{ route('admin.staff.save') }}">
                                @csrf
                                <div class="tab_box_form border bg-transparent rounded">
                                    <div class="row gx-2">
                                        <div class="col col-12">
                                            <input type="text" class="form-control" id="name" name="name" placeholder="Name" required>
                                        </div>
                                        <div class="col col-md-6 col-12">
                                            <input type="email" class="form-control" id="email" name="email" placeholder="Email" required autocomplete="off">
                                        </div>
                                        <!--div class="mb-3">
                                            <label for="phone" class="form-label">Phone:</label>
                                            <input type="text" class="form-control" id="phone" name="phone" required>
                                        </div-->
                                        <div class="col col-md-6 col-12">
                                            <input type="password" class="form-control" id="password" name="password" placeholder="Password" required autocomplete="new-password">
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
                            <div id="errorMessages" class="mt-3"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Edit Employee Modal -->
<div class="modal fade" id="editStaff" tabindex="-1" aria-labelledby="editStaffLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Edit Employee Details</b></h5>

                    <!-- Form -->
                    <form id="editStaffForm" method="POST" action="{{ route('admin.staff.update') }}" class="gx-3 gy-2">
                        @csrf    
                        <input type="hidden" id="editstaff_id" name="staff_id">
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <input type="text" class="form-control" id="edit_name" name="name" placeholder="Name" required>
                            </div>
                           
                            <div class="col col-12">
                                <input type="email" class="form-control" id="edit_email" name="email" placeholder="Email" required>
                            </div>
                            <!--<div class="col col-12">
                                <label for="edit_phone" class="form-label">Phone:</label>
                                <input type="text" class="form-control" id="edit_phone" name="phone" required>
                            </div-->
                          
                           
                        </div>
                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-5 col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-lg-5 col-6">
                                <button type="submit" class="btn btn_theme w-100">Update Details</button> 
                            </div> 
                        </div> 
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Change Employee Password Modal -->
<div class="modal fade" id="changePassword" tabindex="-1" aria-labelledby="changePasswordLabel" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Change Password</b></h5>

                    <!-- Error Messages -->
                    <div id="changePasswordErrors" class="alert alert-danger d-none" role="alert">
                        <ul class="mb-0" id="changePasswordErrorList"></ul>
                    </div>

                    <!-- Success Message -->
                    <div id="changePasswordSuccess" class="alert alert-success d-none" role="alert">
                        <i class="fa fa-check-circle me-2"></i>
                        <span id="changePasswordSuccessMessage">Password changed successfully!</span>
                    </div>

                    <!-- Form -->
                    <form id="changePasswordForm" method="POST" action="{{ route('admin.staff.changePassword') }}" class="gx-3 gy-2">
                        @csrf    
                        <input type="hidden" id="changePassword_staff_id" name="staff_id">
                        <div class="row gx-2 mb-3">                    
                            <div class="col col-12">
                                <div class="position-relative">
                                    <input type="password" class="form-control" id="new_password" name="password" placeholder="New Password" required>
                                    <button type="button" class="btn btn-link position-absolute end-0 top-50 translate-middle-y pe-3" id="toggleNewPassword" style="border: none; background: none; z-index: 10;">
                                        <i class="fa fa-eye" id="newPasswordEyeIcon"></i>
                                    </button>
                                </div>
                                <div class="invalid-feedback d-block" id="password_error" style="display: block !important; margin-top: 5px;"></div>
                            </div>
                            <div class="col col-12">
                                <div class="position-relative">
                                    <input type="password" class="form-control" id="password_confirmation" name="password_confirmation" placeholder="Confirm Password" required>
                                    <button type="button" class="btn btn-link position-absolute end-0 top-50 translate-middle-y pe-3" id="toggleConfirmPassword" style="border: none; background: none; z-index: 10;">
                                        <i class="fa fa-eye" id="confirmPasswordEyeIcon"></i>
                                    </button>
                                </div>
                                <div class="invalid-feedback d-block" id="password_confirmation_error" style="display: block !important; margin-top: 5px;"></div>
                            </div>
                        </div>
                        <div class="row justify-content-center gx-2">
                            <div class="col col-lg-5 col-6">
                                <button type="button" data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-lg-5 col-6">
                                <button type="submit" class="btn btn_theme w-100" id="changePasswordSubmitBtn">Change Password</button> 
                            </div> 
                        </div>                         
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Delete Employees Modal -->
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-light fa-circle-xmark fa-3x mb-3 text-white"></i>
                    <h5 class="mb-4">Are you sure you want to delete this record?</h5>
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

@endsection

@section('script')

<script type="text/javascript">

// Select 2
$('.assigndealer').select2({
    placeholder: 'Assign Dealer Groups',
});
// $('#dealergroupselect').select2();
var $multiempselect = $('#multiempselect');
$multiempselect.select2({
    placeholder: 'Select Assigned Role',
    templateSelection: function() {
    const selectedCount = $multiempselect.select2('data').length;
    return selectedCount + ' selected';
    },
    templateResult: function(data) {
    return data.text;
    }
});
// Update selected count on change for #multiempselect
$multiempselect.on('change', function() {
    const selectedCount = $multiempselect.select2('data').length;
    $('#multiempselect').next('.select2-container').find('.select2-selection__rendered').text(selectedCount + ' selected');
});

var page = '';
var myurl = '{{ route('admin.staff.data') }}';

page = $('#page_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url: myurl,
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
      
        { data: 'email', name: 'email' },
        
      
        {
            data: null,
            orderable: false,
            searchable: false,
            render: function (data, type, row) {
                var staff = JSON.stringify(row);
                
                var editButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#editStaff" data-staff='${staff}' onclick="setEditData(this)">Edit</a>`;
                var changePasswordButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#changePassword" data-id="${row.id}" onclick="setChangePasswordData(${row.id})">Change Password</a>`;
                var deleteButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('{{ route('admin.staff.delete') }}?staff_id=${row.id}')">Delete</a>`;

                var actionDots = `<div class="table_action dropdown">
                                        <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                                        <ul class="dropdown-menu">
                                            <li>`+editButton+`</li>
                                            <li>`+changePasswordButton+`</li>
                                            <li>`+deleteButton+`</li>
                                        </ul>
                                    </div>`;
                return actionDots;
            },
        },
    ],
    language: {
        paginate: {
            first: 'First',
            last: 'Last',
            next: '&rarr;',
            previous: '&larr;',
        },
        lengthMenu: 'Show <select>' +
            '<option value="1" selected>1</option>' +
            '<option value="2">2</option>' +
            '<option value="3">4</option>' +
            '<option value="4">6</option>' +
            '<option value="-1">All</option>' +
            '</select> records',
        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
    },
});

$.ajaxSetup({
    headers: {
        'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
    }
});

function setEditData(buttonElement) {
    var staff = JSON.parse($(buttonElement).attr('data-staff'));
    console.log(staff);
    $('#editstaff_id').val(staff.id);
    $('#edit_name').val(staff.name);
    $('#edit_last_name').val(staff.last_name);
    $('#edit_email').val(staff.email);


    var selectedRole = $('#edit_role').val();
    checkRolePermission(selectedRole, function(hasManageStorePermission) {
        if (hasManageStorePermission) {
            $('.edit-dealergroup-select').show();

            // Pre-select dealer groups based on assigned dealer groups
            var assignedGroups = staff.assing_admin_dealers ? staff.assing_admin_dealers.map(dealer => dealer.dealer_id) : [];
            $('#editDealerGroups').val(assignedGroups).trigger('change');
        } else {
            $('.edit-dealergroup-select').hide();
        }
    });
}

$('#addStaffForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Add Staff');
            if (output.success) {
                $('#createStaff').modal('hide');
                window.location.reload();
                page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#' + key).addClass(key + "error");
                    jQuery('#' + key).valid();
                }
            }
        });
    }
});

$('#editStaffForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Update Staff');
            if (output.success) {
                $('#editStaff').modal('hide');
                  window.location.href ='{{ route('admin.employee') }}'
                //page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#edit_' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#edit_' + key).addClass(key + "error");
                    jQuery('#edit_' + key).valid();
                }
            }
        });
    }
});
function checkRolePermission(roleName, callback) {
    url = '{{ route('admin.checkrole') }}';
    data = { 'role_name': roleName };
    
    runajax(url, data, 'post', '', 'json', function(response) {
        callback(response.hasManageStorePermission);
    });
}

$('.assignrole').change(function() {
    var selectedRole = $(this).val();
    url ='{{route('admin.checkrole')}}'; 
    role_name = $(this).val();
    data = {'role_name':role_name}
    runajax(url, data, 'post', '', 'json', function(response) {
      
            if (response.hasManageStorePermission) {
                $('.dealergroup-select').show();
            } else {
                $('.dealergroup-select').hide();
            }
    })
   
});

// Function to clear all error messages and states
function clearChangePasswordErrors() {
    $('#changePasswordErrors').addClass('d-none');
    $('#changePasswordErrorList').empty();
    $('#changePasswordSuccess').addClass('d-none');
    
    // Clear field errors
    $('#new_password, #password_confirmation').removeClass('is-invalid');
    $('#password_error, #password_confirmation_error').text('');
}

// Function to show error messages
function showChangePasswordErrors(errors) {
    console.log('showChangePasswordErrors called with:', errors);
    clearChangePasswordErrors();
    
    if (errors && Object.keys(errors).length > 0) {
        console.log('Showing errors, removing d-none class');
        var errorElement = $('#changePasswordErrors');
        console.log('Error element found:', errorElement.length);
        console.log('Error element classes before:', errorElement.attr('class'));
        errorElement.removeClass('d-none');
        console.log('Error element classes after:', errorElement.attr('class'));
        console.log('Error element is visible:', errorElement.is(':visible'));
        
        // Show general errors
        if (errors.general) {
            $('#changePasswordErrorList').append('<li>' + errors.general + '</li>');
        }
        
        // Show field-specific errors
        for (var field in errors) {
            if (field !== 'general') {
                var fieldElement;
                var errorElement;
                
                // Map server field names to actual DOM element IDs
                if (field === 'password') {
                    fieldElement = $('#new_password');
                    errorElement = $('#password_error');
                } else if (field === 'password_confirmation') {
                    fieldElement = $('#password_confirmation');
                    errorElement = $('#password_confirmation_error');
                } else {
                    // Try direct mapping for other fields
                    fieldElement = $('#' + field);
                    errorElement = $('#' + field + '_error');
                }
                
                console.log('Processing field:', field, 'Field element found:', fieldElement.length, 'Error element found:', errorElement.length);
                
                if (fieldElement.length && errorElement.length) {
                    console.log('Adding is-invalid class to field and setting error text');
                    fieldElement.addClass('is-invalid');
                    errorElement.text(errors[field][0] || errors[field]);
                    
                    // Also add to general error list for visibility
                    var errorText = errors[field][0] || errors[field];
                    console.log('Adding error to list:', errorText);
                    $('#changePasswordErrorList').append('<li>' + errorText + '</li>');
                } else {
                    console.log('Field or error element not found, adding to general error list');
                    // Add to general error list if field not found
                    $('#changePasswordErrorList').append('<li>' + (errors[field][0] || errors[field]) + '</li>');
                }
            }
        }
        
        // Debug: Check final state of error list
        console.log('Final error list HTML:', $('#changePasswordErrorList').html());
        console.log('Final error list children count:', $('#changePasswordErrorList').children().length);
    }
}

// Function to show success message
function showChangePasswordSuccess(message) {
    clearChangePasswordErrors();
    $('#changePasswordSuccessMessage').text(message || 'Password changed successfully!');
    $('#changePasswordSuccess').removeClass('d-none');
    
    // Auto-hide success message after 3 seconds
    setTimeout(function() {
        $('#changePasswordSuccess').addClass('d-none');
    }, 3000);
}

// Function to validate password confirmation
function validatePasswordConfirmation() {
    var password = $('#new_password').val();
    var confirmPassword = $('#password_confirmation').val();
    
    if (password && confirmPassword && password !== confirmPassword) {
        $('#password_confirmation').addClass('is-invalid');
        $('#password_confirmation_error').text('Passwords do not match');
        return false;
    } else {
        $('#password_confirmation').removeClass('is-invalid');
        $('#password_confirmation_error').text('');
        return true;
    }
}

// Real-time password confirmation validation
$('#password_confirmation').on('input', function() {
    validatePasswordConfirmation();
});

$('#new_password').on('input', function() {
    validatePasswordConfirmation();
});

$('#changePasswordForm').on('submit', function(event) {
    event.preventDefault();
    
    // Clear previous errors
    clearChangePasswordErrors();
    
    // Validate password confirmation
    if (!validatePasswordConfirmation()) {
        // Don't show generic message, just return - field errors are already shown
        return;
    }
    
    // Basic form validation
    var password = $('#new_password').val();
    var confirmPassword = $('#password_confirmation').val();
    
    if (!password || !confirmPassword) {
        // Show specific field errors instead of generic message
        if (!password) {
            $('#new_password').addClass('is-invalid');
            $('#password_error').text('Password is required');
        }
        if (!confirmPassword) {
            $('#password_confirmation').addClass('is-invalid');
            $('#password_confirmation_error').text('Password confirmation is required');
        }
        return;
    }
    
    if (password.length < 8) {
        showChangePasswordErrors({
            password: ['Password must be at least 8 characters long']
        });
        return;
    }
    
    var submitButton = $('#changePasswordSubmitBtn');
    var originalText = submitButton.text();
    
    // Show loading state
    submitButton.prop('disabled', true).html('<i class="fa fa-spinner fa-spin me-2"></i>Changing...');

    var formData = $(this).serialize();
    var url = $(this).attr('action');

    runajax(url, formData, 'post', '', 'json', function(output) {
        console.log('Server response:', output);
        // Reset button state
        submitButton.prop('disabled', false).text(originalText);
        
        if (output.success) {
            showChangePasswordSuccess(output.message || 'Password changed successfully!');
            
            // Clear form
            $('#changePasswordForm')[0].reset();
            
            // Close modal after showing success message
            setTimeout(function() {
                $('#changePassword').modal('hide');
                page.ajax.reload();
            }, 2000);
        } else {
            // Show server-side validation errors
            if (output.data && typeof output.data === 'object') {
                showChangePasswordErrors(output.data);
            } else if (output.errors && typeof output.errors === 'object') {
                showChangePasswordErrors(output.errors);
            } else {
                showChangePasswordErrors({
                    general: output.message || 'An error occurred while changing the password'
                });
            }
        }
    });
});


function setChangePasswordData(staffId) {
    $('#changePassword_staff_id').val(staffId);
    // Clear form and errors when opening modal
    clearChangePasswordErrors();
    $('#changePasswordForm')[0].reset();
}

// Clear form and errors when modal is shown
$('#changePassword').on('show.bs.modal', function() {
    clearChangePasswordErrors();
    $('#changePasswordForm')[0].reset();
});

// Test function to manually trigger error display (for debugging)
function testErrorDisplay() {
    showChangePasswordErrors({
        password: ['The password field must be at least 8 characters.'],
        general: 'This is a test error message'
    });
}

// Test function to force show error element (for debugging)
function testErrorVisibility() {
    $('#changePasswordErrors').removeClass('d-none').show();
    $('#changePasswordErrorList').html('<li>Test error message</li>');
    console.log('Forced error element to show');
}

// Eye icon functionality for password visibility
$('#toggleNewPassword').on('click', function() {
    var passwordField = $('#new_password');
    var eyeIcon = $('#newPasswordEyeIcon');
    
    if (passwordField.attr('type') === 'password') {
        passwordField.attr('type', 'text');
        eyeIcon.removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
        passwordField.attr('type', 'password');
        eyeIcon.removeClass('fa-eye-slash').addClass('fa-eye');
    }
});

$('#toggleConfirmPassword').on('click', function() {
    var passwordField = $('#password_confirmation');
    var eyeIcon = $('#confirmPasswordEyeIcon');
    
    if (passwordField.attr('type') === 'password') {
        passwordField.attr('type', 'text');
        eyeIcon.removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
        passwordField.attr('type', 'password');
        eyeIcon.removeClass('fa-eye-slash').addClass('fa-eye');
    }
});

function seturl(url) {
    document.getElementById('seturl').value = url;
}

function actionmethod() {
    let url = document.getElementById('seturl').value;
    runajax(url, {}, 'GET', '', 'json', function(output) {
        if (output.success) {
            $('#deleteModal').modal('hide');
            page.ajax.reload();
        }
    });
}
</script>

@endsection
