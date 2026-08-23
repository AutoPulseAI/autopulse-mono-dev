@extends('layouts.dealer')

@section('content')

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
                            <div class="col col-md-6 col-12">
                                <div class="position-relative d-flex align-items-center">
                                    <!-- Menu for Mobile -->
                                    <div class="position-relative listing_filter_icon">
                                        <a class="navbar-toggler navbarSideCollapse"><i class="fa-solid fa-bars"></i></a>
                                    </div>

                                    <!-- Heading -->
                                    <div class="acc_page_heading">
                                        <h3>Roles</h3>
                                    </div>
                                </div>
                            </div>
                            <div class="col col-md-6 col-12">
                                <form class="row gx-1">
                                    <div class="col col-md-6 col-12">
                                        <div class="acc_page_search">
                                            <input type="text" value="{{ $input['search'] ??'' }}" name="search" id="searchInput" class="form-control mb-md-0 mb-1" placeholder="Search">
                                        </div>
                                    </div>
                                    <div class="col col-md-3 col-6">
                                        <button type="submit" class="btn btn_theme w-100" >Search</button>
                                    </div>
                                    <div class="col col-md-3 col-6">
                                        <a href="{{ route('dealer.myvehicle') }}" class="btn btn_theme w-100" >Reset</a>
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
                        <ul class="nav nav-pills border-bottom underline_tabs" id="profileTab" role="tablist">
                            <li class="nav-item" role="presentation">
                                <a class="nav-link active" href="{{route('dealer.role')}} "  role="tab" aria-controls="rolesList" aria-selected="true">Roles</a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link" id="form-tab" data-bs-toggle="tab" href="#roleForm" role="tab" aria-controls="roleForm" aria-selected="false">Role Creation</a>
                            </li>
                        </ul>
                        <div class="tab-content px-3" id="rolesTabContent">
                            <!-- Roles -->
                            <div class="tab-pane fade show active" id="rolesList" role="tabpanel" aria-labelledby="table-tab">
                                <div class="position-relative py-4">
                                    <?php foreach($roles as $key =>$value)  { 
                                      
                                         // Use regex to remove the '_dealerId' part
                                            $roleName = preg_replace('/_\d+$/', '', $value->name);
                                      
                                        
                                        ?> 

                                    <div class="dealer_lead_card" id="dealer_lead_card_{{ $value->id }}">
                                        <div class="row gx-1">
                                            <div class="col col-md-9 col-8">
                                                <div class="leads_by text-capitalize">
                                                    <p class="mb-0"><b>{{ $roleName }} </b></p>
                                                </div>
                                            </div>
                                            <div class="col col-md-2 col-3">
                                                <div class="d-flex align-items-center">
                                                    <a href="javascript:;" data-bs-toggle="modal" data-bs-target="#editRole" class="text_primary ms-auto edit-role" data-role="{{ $value->id }}" data-role-name="{{ $value->name }}" data-permissions="{{ json_encode($value->permissions->pluck('name')->toArray()) }}"><small>Edit</small></a>
                                                    <a class="dropdown-item" data-id="{{ $value->id }}" data-bs-toggle="modal" data-bs-target="#deleteModal">Delete</a>
                                                    <!--a href="javascript:;" data-bs-toggle="modal" data-bs-target="#editRole" class="text_primary ms-auto"><small>Edit</small></a-->
                                                </div>
                                            </div>
                                            <div class="col col-md-1 col-1 collapsible_button">
                                                <div class="d-flex align-items-center">
                                                    <a href="javascript:;" class="text_secondary ms-auto"><i class="fa-solid fa-chevron-down"></i></a>
                                                </div>
                                            </div>

                                            <div class="col col-12 collapsible_content" style="display: none;">
                                                <div class="row">
                                                    @foreach($value->permissions as $permission)
                                                    <div class="col col-lg-3 col-md-4 col-12">
                                                        <div class="leads_by">
                                                            <p class="mb-0"><small><i class="fa-solid fa-circle-check me-1 text-primary"></i>{{ $permission->name }}</small></p>
                                                        </div>
                                                    </div>
                                                    @endforeach
                                                </div>                            
                                            </div>
                                        </div>                                                                
                                    </div>

                                    <?php } ?> 
                                </div>
                            </div>
                            
                            <!-- Role Form Tab -->
                            <div class="tab-pane fade" id="roleForm" role="tabpanel" aria-labelledby="form-tab">
                                <div class="row mt-3">
                                    <div class="col col-lg-6 col-md-12 col-12">
                                        <div class="acc_profile_address acc_page_box border-0">
                                            <!-- Form -->
                                            <form action="{{ route('adddealer.role') }}" class="row" id="add_role_form" method="post" enctype="multipart/form-data">  
                                                @csrf    
                                                <div class="position-relative mb-3">
                                                <input type="hidden" name="dealer_id" value="{{$parentId }}" class="form-control required">
                                                    <input type="text" id="role_name" name="role_name" placeholder="Role Name" value="" class="form-control required">
                                                </div>

                                                <div class="position-relative text-capitalize">
                                                    <p class="mb-2"><b>Premissions</b></p>
                                                    @foreach($permissions as $key =>$value)
                                                    <div class="form-check">
                                                        <input name= "permissions[]" class="form-check-input" type="checkbox" value="{{ $value }}" id="{{ str_replace(' ','_',$value) }}">
                                                        <label class="form-check-label" for="{{ str_replace(' ','_',$value) }}">{{ $value }}</label>
                                                    </div>
                                                    @endforeach
                                                    
                                                </div>

                                                <div class="position-relative mt-3">
                                                    <button type="button" id="addrole" name="submit" class="btn btn_theme">Create Role</button> 
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
</section>

<!-- Edit Role Modal -->
<div class="modal fade" id="editRole" tabindex="-1" aria-labelledby="editRoleLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-body">
        <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
        <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
            <h5 class="modal-title text_primary mb-3"><b>Edit Role</b></h5>

            <!-- Form -->
            <form action="{{ route('dealerupdate.role') }}" class="row" id="update_role_form" method="post" enctype="multipart/form-data">  
                @csrf
              
                <input type="hidden" id="edit_role_id" name="role_id" value="">
                <input type="hidden" name="dealer_id" value="{{ $parentId }}" class="form-control required">
                <div class="position-relative mb-3">
                    <input type="text" id="edit_role_name" name="role_name" placeholder="Role Name" value="" class="form-control required">
                </div>

                <div class="position-relative text-capitalize">
                    <p class="mb-2"><b>Premissions</b></p>
                    @foreach($permissions as $permission)
                    <div class="form-check">
                        <input name="permissions[]" class="form-check-input" type="checkbox" value="{{ $permission }}" id="edit_{{ str_replace(' ', '_', $permission) }}">
                        <label class="form-check-label" for="edit_{{ str_replace(' ', '_', $permission) }}">{{ $permission }}</label>
                    </div>
                    @endforeach
                </div>

                <div class="position-relative mt-3">
                    <button type="button" id="updaterole" name="submit" class="btn btn_theme w-100">Update</button> 
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
$(document).ready(function(){
    $(".collapsible_button").click(function(){
        var content = $(this).next(".collapsible_content");
        content.slideToggle(300);

        var arrow = $(this).find(".fa-chevron-down");
        arrow.toggleClass("rotate");
    });
});
$('#deleteModal').on('show.bs.modal', function (e) {
        var button = $(e.relatedTarget);
        var id = button.data('id');
        $('#deleteModal').data('id', id);
    });
    $('#confirmDelete').on('click', function () {
        var id = $('#deleteModal').data('id');
        formData ={ 'role_id': id };
        url = `{{route('dealer.delete.role')}}`;
        runajax(url, formData, 'get', '', 'json', function(output) {
        
           
                if (output.success) {
                    $('#dealer_lead_card_'+id).remove();
                    $('#deleteModal').modal('hide');
                } else {
                    // Handle deletion errors
                }
            
        });
    });
</script>
<script>
    $('#add_role_form  button').click(function(e){
        e.preventDefault();
        $('#add_role_form button').text('Please wait...');
        $('#add_role_form button').attr('disabled', 'disabled');
        
        if($('#add_role_form').valid()) {    
            url = `{{route('adddealer.role')}}`;
            var formData = new FormData($('#add_role_form')[0]);
            
            uploadajax(url, formData, 'post', '', 'json', function(output) {
                $('#add_role_form button').text('Add Role ');
                $('#add_role_form button').removeAttr('disabled');
                
                if (output.success) {
                    $('#add_role_form')[0].reset();
                    $('.successmsgdiv').html(output.message)
                    $('#thank_you').modal('show');
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
        } else {
            $('#add_role_form button').text('Add Role');
            $('#add_role_form button').removeAttr('disabled');
        }
    });

    $('#update_role_form  button').click(function(e){
        e.preventDefault();
        $('#update_role_form button').text('Please wait...');
        $('#update_role_form button').attr('disabled', 'disabled');
        
        if($('#update_role_form').valid()) {    
            url = `{{route('dealerupdate.role')}}`;
            var formData = new FormData($('#update_role_form')[0]);
            
            uploadajax(url, formData, 'post', '', 'json', function(output) {
                $('#update_role_form button').text('Update Role ');
                $('#update_role_form button').removeAttr('disabled');
                if (output.success) {
                    $('.modal').modal('hide');
                    $('.successmsgdiv').html(output.message)
                    $('#thank_you').modal('show');
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
        } else {
            $('#update_role_form button').text('Update Role');
            $('#update_role_form button').removeAttr('disabled');
        }
    });
    $('.edit-role').click(function() {
        var roleId = $(this).data('role');
        var roleName = $(this).data('role-name');
        var rolePermissions = $(this).data('permissions');
        var cleanedRoleName = roleName.replace(/_\d+$/, '');
        $('#edit_role_id').val(roleId);
        $('#edit_role_name').val(cleanedRoleName);

        // Uncheck all permissions first
        $('#update_role_form input[type="checkbox"]').prop('checked', false);

        // Check the role's permissions
        $.each(rolePermissions, function(index, permission) {
            $('#update_role_form input[value="' + permission + '"]').prop('checked', true);
        });
    });
    $('#searchInput').on('keyup', function() {
            var value = $(this).val().toLowerCase();
            $('.dealer_lead_card').filter(function() {
                $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
            });
        });
</script>


@endpush
