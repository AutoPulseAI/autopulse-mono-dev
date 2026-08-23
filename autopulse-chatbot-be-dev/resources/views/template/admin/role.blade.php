@extends('layouts.admin')

@section('content')
<input type="hidden" id="seturl" value="">

<div class="position-relative">
    <div class="row">
        <div class="col col-md-4 col-12 page_title">
            <div class="page_title mb-3">
                <h2>Manage Role</h2>
            </div>
        </div>
        <!-- <div class="col col-md-8 col-12">
            <div class="position-relative">
                <form class="row gx-1 justify-content-md-end">
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
                    <div class="col col-md-6 col-12">
                        <div class="acc_page_search">
                            <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                        </div>
                    </div>
                    <div class="col col-md-2 col-6">
                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                    </div>
                    <div class="col col-md-2 col-6">
                        <a href="{{ route('dealer.myvehicle') }}" class="btn btn_theme w-100" >Reset</a>
                    </div>
                </form>
            </div>
        </div> -->
    </div>

    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif

    <div class="tab_box">
        <!-- Nav pills -->
        <ul class="nav nav-pills underline_tabs border-bottom mt-3" role="tablist">
            <li class="nav-item">
                <a class="nav-link active" data-bs-toggle="pill" href="#rolesList">All Roles</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" data-bs-toggle="pill" href="#rolesForm">Add Role</a>
            </li>
        </ul>

        <!-- Tab panes -->
        <div class="tab-content">
            <!-- All Roles -->
            <div id="rolesList" class="tab-pane active">
                <div class="position-relative table-responsive pt-2" style="min-height: 300px;">
                    <table class="table table-bordered w-100 dataTable" id="page_tabl">
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>Role</td>
                                <td>Permissions</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>

            <!-- Role Form Tab -->
            <div id="rolesForm" class="tab-pane fade">
                <div class="row justify-content-center mt-3">
                    <div class="col col-xl-7 col-lg-9 col-md-12 col-12">
                        <div class="position-relative mb-3">
                            <form id="addRoleForm" method="POST" action="{{ route('admin.role.add') }}" class="gx-3 gy-2">
                                @csrf
                                <div class="tab_box_form border-0 bg_yellow rounded">
                                    <div class="row gx-2 mb-3">
                                        <div class="col col-12">
                                            <input type="text" class="form-control" id="role_name" name="role_name" placeholder="Role Name" required>
                                        </div>
                                        <div class="col col-12">
                                            <div class="position-relative text-capitalize">
                                                <p class="mb-2"><b>Permissions</b></p>
                                                @foreach($permissions as $key =>$value)
                                                <div class="form-check">
                                                    <input name= "permissions[]" class="form-check-input" type="checkbox" value="{{ $value->name }}" id="{{ str_replace(' ','_',$value) }}">
                                                    <label class="form-check-label" for="{{ str_replace(' ','_',$value) }}">{{ $value->name }}</label>
                                                </div>
                                                @endforeach
                                                
                                            </div>

                                            <!-- <select class="form-select w-100" id="permissions" name="permissions[]" multiple>
                                                @foreach($permissions as $permission)
                                                    <option value="{{ $permission->name }}">{{ $permission->name }}</option>
                                                @endforeach
                                            </select> -->
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col col-md-12 col-12">
                                        <div class="position-relative text-center mt-3">
                                            <button type="submit" class="btn btn_theme">Submit</button> 
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

<!-- Edit Role Modal -->
<div class="modal fade" id="editRole" tabindex="-1" aria-labelledby="editStaffLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>Edit Employee Details</b></h5>

                    <!-- Form -->
                    <form id="editRoleForm" method="POST" action="{{ route('admin.role.update') }}" class="gx-3 gy-2">
                        @csrf    
                        <input type="hidden" id="editrole_id" name="role_id">
                        <div class="row gx-2 mb-3">
                            <div class="col col-12">
                                <input type="text" class="form-control" id="editrole_name" name="role_name" required>
                            </div>
                            <div class="col col-12">
                                <div class="position-relative text-capitalize">
                                    <p class="mb-2"><b>Permissions</b></p>
                                    @foreach($permissions as $permission)
                                    <div class="form-check">
                                        <input name="permissions[]" class="form-check-input" type="checkbox" value="{{ $permission->name }}" id="edit_{{ str_replace(' ', '_', $permission->name) }}">
                                        <label class="form-check-label" for="edit_{{ str_replace(' ', '_', $permission->name) }}">{{ $permission->name }}</label>
                                    </div>
                                    @endforeach
                                </div>

                                <!-- <select class="form-select w-100" id="editPermissions" name="permissions[]" multiple>
                                    @foreach($permissions as $permission)
                                        <option value="{{ $permission->name }}">{{ $permission->name }}</option>
                                    @endforeach
                                </select> -->
                            </div>
                        </div>
                        <div class="row gx-2">
                            <div class="col col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-6">
                                <button type="submit" class="btn btn_theme w-100">Update Role</button> 
                            </div> 
                        </div> 
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Delete Modal -->
<div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
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
                        <div class="row gx-2">
                            <div class="col col-6">
                                <button data-bs-dismiss="modal" class="btn btn-outline-primary w-100">Cancel</button> 
                            </div> 
                            <div class="col col-6">
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
$('#permissions').select2({
    placeholder: 'Permission'
});
$('#editPermissions').select2({
    placeholder: 'Permission'
});

// Table
var page ='';
var myurl = '{{route('adminrole.data')}}?guard=admin';

page= $('#page_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('adminrole.data')}}?guard=admin',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
        { data: 'permissions_list', name: 'permissions_list' },
        {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
                var editButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#editRole" 
                          data-permission='${JSON.stringify(row.permissions).replace(/'/g, "\\'")}' onclick="setEditData(${row.id}, '${row.name.replace(/'/g, "\\'")}',this)">Edit</a>`;
                var deleteButton = `<a class="dropdown-item" href="javascript:" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('{{ route('admin.role.delete') }}?role_id=${row.id}')">Delete</a>`;

                var actionDots = `<div class="table_action dropdown">
                                        <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                                        <ul class="dropdown-menu">
                                            <li>`+editButton+`</li>
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

function setEditData(id, name, buttonElement) {
    $('#editrole_id').val(id);
    $('#editrole_name').val(name);

    // Get permissions from the data-permission attribute of the button
    var permissions = $(buttonElement).data('permission');
    console.log(permissions);
    if (typeof permissions === 'string') {
        permissions = JSON.parse(permissions);
    }
    console.log(permissions);

    // Extract permission IDs (or names) from the permissions array
    var permissionNames = permissions.map(permission => permission.name);
    console.log('Permission names:', permissionNames);

    // Uncheck all permissions first
    $('#editRoleForm input[type="checkbox"]').prop('checked', false);

    // Check the role's permissions
    $.each(permissionNames, function(index, permission) {
        $('#editRoleForm input[value="' + permission + '"]').prop('checked', true);
    });
}

$('#addRoleForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Create Role');
            if (output.success) {
                window.location.href ='{{ route('admin.role') }}'
                page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#' + key).addClass( key + "error");
                    jQuery('#' + key).valid();
                }
            }
        });
    }
});

$('#editRoleForm').on('submit', function(event) {
    event.preventDefault();
    if ($(this).valid()) {
        var submitButton = $(this).find('[type="submit"]');
        submitButton.prop('disabled', true).text('Please wait...');

        var formData = $(this).serialize();
        var url = $(this).attr('action');

        runajax(url, formData, 'post', '', 'json', function(output) {
            submitButton.prop('disabled', false).text('Update Role');
            if (output.success) {
                $('#editRole').modal('hide');
                page.ajax.reload();
            } else {
                for (var key in output.data) {
                    existvalue = $('#edit' + key).val();
                    jQuery.validator.addMethod(key + "error", function(value, element) {
                        return this.optional(element) || value !== existvalue;
                    }, jQuery.validator.format(output.data[key][0]));
                    jQuery('#edit' + key).addClass( key + "error");
                    jQuery('#edit' + key).valid();
                }
            }
        });
    }
});

function seturl(url) {
    document.getElementById('seturl').value = url;
}

function actionmethod() {
    let url = document.getElementById('seturl').value;
    runajax(url, {}, 'DELETE', '', 'json', function(output) {
        if (output.success) {
            $('#deleteModal').modal('hide');
            page.ajax.reload();
        }
    });
}
</script>

@endsection
