@extends('layouts.dealer')

@section('content')
<style>
.select2-container--default .select2-results__option[aria-selected=true] {
    background-color: #ddd !important;
}
.select2-container--default .select2-results__option--highlighted[aria-selected] {
    background-color: unset;
    color: initial;
}
</style>
<section class="account_main" id="subpage_mt">
    <div class="container">
        <div class="row">
            <div class="col col-lg-3 col-12">
                @include('template.dealers.include.sidebar')
            </div>
            <div class="col col-lg-9 col-12">
                @php
                    $user = Auth::guard('dealer')->user();  
                @endphp
                <div class="acc_right_main">
                    <div class="acc_page_head sticky" id="acc_page_head">
                        <div class="row align-items-center">
                            <div class="col col-md-4 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Employees</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-8 col-12">
                                <form class="row gx-1">
                                    <div class="col col-md-4 col-7">
                                        <div class="acc_page_search">
                                            <input type="text" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                        </div>
                                    </div>
                                    <div class="col col-md-4 col-5">
                                        <div class="acc_page_search">
                                            <select class="form-select mb-0" id="roleFilter">
                                                <option value="" selected>Role</option>
                                                @foreach($roles as $role)
                                                    @php
                                                        $roleName = preg_replace('/_\d+$/', '', $role->name);
                                                    @endphp
                                                    <option value="{{ $roleName }}">{{ $roleName }}</option>
                                                @endforeach
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <button type="button" class="btn btn_theme w-100" id="searchButton">Search</button>
                                    </div>
                                    <div class="col col-md-2 col-6">
                                        <button type="button" class="btn btn_theme w-100" id="resetButton">Reset</button>
                                    </div>
                                </form>
                            </div>
                            <div class="col col-12">
                                @if($user && !$user->email_verified_at)
                                    <div class="alert alert-danger" role="alert">
                                        Your email address is not verified. Please verify it to access all features. <a href="{{route('dealer.sendverify')}}">Send Verification Mail</a>
                                    </div>
                                @endif
                                @if (session('success'))
                                    <div class="alert alert-success">
                                        {{ session('success') }}
                                    </div>
                                @endif
                                @if (session('error'))
                                    <div class="alert alert-danger">
                                        {{ session('error') }}
                                    </div>
                                @endif
                            </div>
                        </div>
                    </div>

                    <div class="acc_page_content acc_page_box px-0 py-3">
                        <ul class="nav nav-pills border-bottom underline_tabs mb-2 mb-md-0" id="profileTab" role="tablist">
                            <li class="nav-item" role="presentation">
                                <a class="nav-link active" id="table-tab" data-bs-toggle="tab" href="#employeesList" role="tab" aria-controls="employeesList" aria-selected="true">All Employees</a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link" id="form-tab" data-bs-toggle="tab" href="#employeeForm" role="tab" aria-controls="employeeForm" aria-selected="false">Add Employee</a>
                            </li>
                        </ul>
                        <div class="tab-content" id="employeesTabContent">
                            <!-- Employees -->
                            <div class="tab-pane fade show active" id="employeesList" role="tabpanel" aria-labelledby="table-tab">
                                <div class="position-relative">
                                    <div class="dealer_lead_card bg_yellow pt-2 px-3 d-none d-md-block">
                                        <div class="row gx-1">
                                            <div class="col col-md-10 col-9">
                                                <div class="row gx-1">
                                                    <div class="col col-md-4 col-12">
                                                        <div class="leads_by">
                                                            <p class="mb-0">Employee Name</p>
                                                        </div>
                                                    </div>
                                                    <div class="col col-md-4 col-12">
                                                        <div class="leads_by">
                                                            <p class="mb-0">Assigned Role</p>
                                                        </div>
                                                    </div>
                                                    <div class="col col-md-4 col-12">
                                                        <div class="leads_by">
                                                            <p class="mb-0">Assigned Stores</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>                                                                
                                    </div>
                                    <div id="employeeList">
                                        @foreach ($employees as $employee)
                                        @php $dealershipNames = [];
                                       
                                            if (!empty($employee['assignSource'])) {
                                                foreach ($employee['assignSource'] as $sources) {
                                                   
                                                    if (isset($sources['source']['dealership_name'])) {
                                                        $dealershipNames[] = $sources['source']['dealership_name'];
                                                    }
                                                }
                                            }
                                        @endphp
                                        <div id="dealer_lead_{{ $employee->id }}" class="dealer_lead_card px-md-3 employee-item" data-name="{{ $employee->name }} " data-role="{{ preg_replace('/_\d+$/', '', optional($employee->roles->first())->name) }}">
                                            <div class="row gx-1">
                                                <div class="col col-md-10 col-9">
                                                    <div class="row gx-1">
                                                        <div class="col col-md-4 col-12">
                                                            <div class="leads_by">
                                                                <p class="mb-0"><b>{{ $employee->name }} </b></p>
                                                            </div>
                                                        </div>
                                                        <div class="col col-md-4 col-12">
                                                            <div class="leads_by">
                                                                <p class="mb-0">{{ preg_replace('/_\d+$/', '', optional($employee->roles->first())->name) }}</p>
                                                            </div>
                                                        </div>
                                                        <div class="col col-md-4 col-12">
                                                            <div class="leads_by">
                                                                <a tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-html="true" data-bs-content="<span>{{ implode('<br>', $dealershipNames) }}</span>" class="text_dark text-decoration-underline mb-0">View Assigned Stores</a>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="col col-md-2 col-3">
                                                    <div class="position-relative">
                                                        <div class="list_action dropdown">
                                                            <a class="dropdown-toggle d-flex" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical ms-auto"></i></a>
                                                            <ul class="dropdown-menu">
                                                                <li><a href="javascript:;" data-bs-toggle="modal" data-bs-target="#editEmployee" class="dropdown-item text_primary ms-auto edit-employee" data-id="{{ $employee->id }}" data-first-name="{{ $employee->name }}" data-last-name="" data-email="{{ $employee->email }}" data-role-id="{{ optional($employee->roles->first())->id }}" data-assigned-sources="{{ optional(optional($employee->assignSource)->pluck('dealer_source_id'))->implode(',') }}">Edit</a></li>
                                                                <li><a href="javascript:;" data-bs-toggle="modal" data-bs-target="#changePasswordModal" class="dropdown-item text_primary ms-auto change-password d-block text-nowrap" data-id="{{ $employee->id }}">Change Password</a></li>
                                                                <li><a href="javascript:;" data-bs-toggle="modal" data-bs-target="#deleteModal" class="dropdown-item text_primary ms-auto change-password d-block text-nowrap" data-id="{{ $employee->id }}">Delete Employee</a></li>
                                                            </ul>
                                                        </div>                                                        
                                                    </div>
                                                </div>
                                            </div>                                                                
                                        </div>
                                        @endforeach
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Role Form Tab -->
                            <div class="tab-pane fade" id="employeeForm" role="tabpanel" aria-labelledby="form-tab">
                                <div class="row justify-content-center mt-3">
                                    <div class="col col-lg-9 col-md-12 col-12">
                                        <div class="acc_profile_address acc_page_box border-0 bg_yellow rounded">
                                            <!-- Form -->
                                            <div class="position-relative mb-3">
                                                <form action="{{ route('dealer.store.employee') }}" class="row gx-3 gy-2" id="add_store_employee" method="post" enctype="multipart/form-data">  
                                                    @csrf    
                                                    <div class="col col-md-6 col-6">
                                                        <input type="text" id="emp_name" name="name" placeholder="First Name" value="" class="form-control required">
                                                    </div>
                                                    <div class="col col-md-6 col-6">
                                                        <input type="text" id="emp_last_name" name="last_name" placeholder="Last Name" value="" class="form-control required">
                                                    </div>
                                                    <div class="col col-md-6 col-12">
                                                        <input type="text" class="form-control required" id="emp_email" name="email" placeholder="Email" value="">
                                                    </div>
                                                    <div class="col col-md-6 col-12">
                                                        <input type="password" class="form-control required" id="emp_password" name="password" placeholder="Password" value="">
                                                    </div>
                                                    <div class="col col-md-12 col-12">
                                                        <div class="multiselect">
                                                            <select id="emp_source" multiple="multiple" class="form-control w-100 multi1" name="sources[]">
                                                                @foreach($source as $key => $value)
                                                                    <option value="{{ $value->id }}" class="multiseleoption">{{ $value->source }}</option>
                                                                @endforeach
                                                            </select>
                                                        </div>                                                        
                                                    </div>
                                                    <div class="col col-md-12 col-12">
                                                        <select name="role" id="role" class="form-control required">
                                                                <option selected disabled>Assign Role</option>
                                                                @foreach($roles as $key => $value)
                                                                @php
                                                                    $roleName = preg_replace('/_\d+$/', '', $value->name);
                                                                @endphp
                                                                    <option value="{{ $value->id }}">{{ $roleName }}</option>
                                                                @endforeach
                                                        </select>
                                                    </div>
                                                    <div class="col col-md-12 col-12">
                                                        <div class="position-relative text-center mt-3">
                                                            <button type="button" id="" name="submit" class="btn btn_theme">Add Employee</button> 
                                                        </div>
                                                    </div> 
                                                </form>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Change Password Modal -->
<div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="changePasswordModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Change Password</b></h5>
                    <form id="change_password_form" method="POST" action="{{ route('dealer.changePassword') }}">
                        @csrf
                        <input type="hidden" id="changePasswordEmployeeId" name="dealer_id">
                        <div class="position-relative mb-3">
                            <input type="password" class="form-control" id="new_password" name="password" placeholder="New Password" required>
                        </div>
                        <div class="position-relative mb-3">
                            <input type="password" class="form-control" id="confirm_password" name="password_confirmation" placeholder="Confirm New Password" required>
                        </div>
                        <div class="position-relative mt-3">
                            <button type="submit" class="btn btn_theme w-100">Update Password</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>


<!-- Edit Employee Modal -->
<div class="modal fade" id="editEmployee" tabindex="-1" aria-labelledby="editEmployeeLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Edit Employee</b></h5>
                    <form id="edit_employee_form" method="POST" action="{{ route('dealerupdate.employee') }}">
                        @csrf
                        <input type="hidden" id="editemplyee" name="id">
                        <div class="position-relative">
                            <input type="text" class="form-control" id="editname" name="name" placeholder="First Name" required>
                        </div>
                        <div class="position-relative">
                            <input type="text" class="form-control" id="editlast_name" name="last_name" placeholder="Last Name" required>
                        </div>
                        <div class="position-relative">
                            <input type="email" class="form-control" id="editemail" name="email" placeholder="Email" required>
                        </div>                        
                        <div class="position-relative">
                            <div class="multiselect">
                                <select class="multi2" id="editsources" name="sources[]" multiple="multiple">
                                    @foreach($source as $row)
                                        <option value="{{ $row->id }}">{{ $row->source }}</option>
                                    @endforeach
                                </select>                    
                            </div>
                        </div>
                        <div class="position-relative">
                            <select class="form-control" id="editrole" name="role" required>
                                <option selected disabled>Assign Role</option>
                                @foreach($roles as $key => $value)
                                @php
                                    $roleName = preg_replace('/_\d+$/', '', $value->name);
                                @endphp
                                    <option value="{{ $value->id }}">{{ $roleName }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div class="position-relative mt-3">
                            <button type="submit" class="btn btn_theme w-100">Update</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0">
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body pb-4">
                <div class="position-relative text-center">
                    <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                    <h5 class="mb-4">Are you sure? You want to delete?</h5>
                    <div class="position-relative text-center">                    
                        <button type="button" class="btn btn-danger" id="confirmDelete">Yes</a>
                        <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection

@push('after-scripts')
<script src="https://maps.googleapis.com/maps/api/js?key={{ env('GOOGLE_PLACE_API') }}&libraries=places"></script>
<script>
var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'))
var popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
  return new bootstrap.Popover(popoverTriggerEl)
})
$('#deleteModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#deleteModal').data('id', id);
    });
    $('#confirmDelete').on('click', function () {
        var id = $('#deleteModal').data('id');
        formData ={ 'dealer_id': id };
        url = `{{route('dealer.delete.staff')}}`;
        runajax(url, formData, 'get', '', 'json', function(output) {
        
           
                if (output.success) {
                    $('#dealer_lead_'+id).remove();
                    $('#deleteModal').modal('hide');
                } else {
                    // Handle deletion errors
                }
            
        });
    });
</script>
<script>
$(document).ready(function() {
    // Initialize multi-select
    $('#emp_source').select2({
        placeholder: "Assign Store"
    });
    $('#editsources').select2({
        placeholder: "Assign Store"
    });

    // Collapsible button functionality
    $(".collapsible_button").click(function() {
        var content = $(this).next(".collapsible_content");
        content.slideToggle(300);
        var arrow = $(this).find(".fa-chevron-down");
        arrow.toggleClass("rotate");
    });

    // JavaScript search functionality
    $('#searchInput').on('keyup', function() {
        var searchTerm = $(this).val().toLowerCase();
        $('.employee-item').each(function() {
            var name = $(this).data('name').toLowerCase();
            var role = $(this).data('role').toLowerCase();
            if (name.includes(searchTerm) || role.includes(searchTerm)) {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    });

    $('#roleFilter').on('change', function() {
        var roleFilter = $(this).val().toLowerCase();
        $('.employee-item').each(function() {
            var role = $(this).data('role').toLowerCase();
            if (role.includes(roleFilter) || roleFilter === '') {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    });

    $('#resetButton').on('click', function() {
        $('#searchInput').val('');
        $('#roleFilter').val('');
        $('.employee-item').show();
    });

    // Add employee form submission
    $('#add_store_employee button').click(function(e) {
        e.preventDefault();
        var $button = $(this);
        $button.text('Please wait...');
        $button.attr('disabled', 'disabled');
        
        if ($('#add_store_employee').valid()) {
            var url = `{{ route('dealer.store.employee') }}`;
            var formData = new FormData($('#add_store_employee')[0]);
            
            uploadajax(url, formData, 'post', '', 'json', function(output) {
                $button.text('Add Employee');
                $button.removeAttr('disabled');
                
                if (output.success) {
                    $('.successmsgdiv').html(output.message);
                    $('#thank_you').modal('show');
                    $('#add_store_employee')[0].reset();
                    window.location.href ="{{ route('dealer.employee') }}";
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#emp_' + key).val();
                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        jQuery('#emp_' + key).addClass(key + "error");
                        jQuery('#emp_' + key).valid();
                    }
                }
            });
        } else {
            $button.text('Add Employee');
            $button.removeAttr('disabled');
        }
    });

    // Edit employee form submission
    $('#edit_employee_form button').click(function(e) {
        e.preventDefault();
        var $button = $(this);
        $button.text('Please wait...');
        $button.attr('disabled', 'disabled');
        
        if ($('#edit_employee_form').valid()) {
            var url = `{{ route('dealerupdate.employee') }}`;
            var formData = new FormData($('#edit_employee_form')[0]);
            
            uploadajax(url, formData, 'post', '', 'json', function(output) {
                $button.text('Update Employee');
                $button.removeAttr('disabled');
                
                if (output.success) {
                    $('.modal').modal('hide');
                    $('.successmsgdiv').html(output.message)
                    $('#thank_you').modal('show');
                    window.location.href ="{{ route('dealer.employee') }}";
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#edit' + key).val();
                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        jQuery('#' + key).addClass(key + "error");
                        jQuery('#' + key).valid();
                    }
                }
            });
        } else {
            $button.text('Update Employee');
            $button.removeAttr('disabled');
        }
    });

    // Modal reset and data filling
    $('#editEmployee').on('hidden.bs.modal', function() {
        $(this).find('form')[0].reset();
        $('#editsources').val(null).trigger('change');
    });

    $('.edit-employee').click(function() {
        var employeeId = $(this).data('id');
        var firstName = $(this).data('first-name');
        var lastName = $(this).data('last-name');
        var email = $(this).data('email');
        var roleId = $(this).data('role-id');
        var assignedSources = $(this).data('assigned-sources');

        if (assignedSources) {
            var sourcesArray = assignedSources.toString().split(',');
            $('#editsources').val(sourcesArray).trigger('change');
        } else {
            $('#editsources').val(null).trigger('change');
        }
        $('#editemplyee').val(employeeId);
        $('#editname').val(firstName);
        $('#editlast_name').val(lastName);
        $('#editemail').val(email);
        $('#editrole').val(roleId);

        //$('#editsources').val(assignedSources).trigger('change');
    });
    $('.change-password').click(function() {
        var employeeId = $(this).data('id');
        $('#changePasswordEmployeeId').val(employeeId);
    });

    $('#change_password_form').submit(function(e) {
        e.preventDefault();
        var $button = $(this).find('button');
        $button.text('Please wait...');
        $button.attr('disabled', 'disabled');

        if ($('#change_password_form').valid()) {
            var url = `{{ route('dealer.changePassword') }}`;
            var formData = new FormData($('#change_password_form')[0]);

            uploadajax(url, formData, 'post', '', 'json', function(output) {
                $button.text('Update Password');
                $button.removeAttr('disabled');

                if (output.success) {
                    $('.successmsgdiv').html(output.message);
                    $('#changePasswordModal').modal('hide');
                    $('#change_password_form')[0].reset();
                } else {
                    for (var key in output.data) {
                        var existvalue = $('#change_password_form #new_password').val();
                        jQuery.validator.addMethod(key + "error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        jQuery('#change_password_form #new_password').addClass(key + "error");
                        jQuery('#change_password_form #new_password').valid();
                    }
                }
            });
        } else {
            $button.text('Update Password');
            $button.removeAttr('disabled');
        }
    });
});

</script>
@endpush
