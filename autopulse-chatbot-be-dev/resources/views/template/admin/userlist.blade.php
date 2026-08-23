@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="position-relative">

    <div class="row">
        <div class="col col-xl-2 col-lg-12 col-md-12 col-12">
            <div class="page_title mb-3 mb-xl-0">
                <h2>All Users</h2>
            </div>
        </div>
        <div class="col col-xl-10 col-lg-12 col-md-12 col-12">
            <div class="position-relative">
                <div class="row gx-1 justify-content-end"> 
                    <div class="col col-lg-10 col-md-12 col-12"> 
                        <form id="userFilter" method="GET" class="row gx-1">
                            <label class="col col-lg-4 col-md-4 col-12 d-flex align-items-center">
                                From:&nbsp;<input type="date" id="user-form" name="from" class="form-control form-control-sm me-md-1" value="{{Request::get('from')}}"> 
                            </label>
                            <label class="col col-lg-4 col-md-4 col-12 d-flex align-items-center">
                                To:&nbsp;<input type="date" id="user-to" name="to" class="form-control form-control-sm" value="{{Request::get('to')}}">
                            </label>
                            <div class="col col-lg-2 col-md-2 col-6">
                                <button type="submit" class="btn btn_theme w-100" value="Filter">Submit</button>
                            </div>
                            <div class="col col-lg-2 col-md-2 col-6">
                                <a href="{{ route('userlist.index') }}" class="btn btn_theme w-100">Reset</a>
                            </div>
                        </form>
                    </div>
                    <div class="col col-lg-2 col-md-4 col-6"> 
                        <form id="userDownload" method="GET" class="dwn_csv">
                            <input type="hidden" name="export" class="form-control" value=""> 
                            <input type="hidden" name="ids" class="form-control export-ids"> 
                            <input type="hidden" name="from" class="form-control" value="{{Request::get('from')}}"> 
                            <input type="hidden" name="to" class="form-control" value="{{Request::get('to')}}"> 
                            <input type="submit" class="btn btn-dark mb-2 ms-1" value="Download CSV">
                        </form>
                    </div>
                </div>
            </div>
        </div>
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

    <div class="tab_box py-3">
        <div class="row">
            <div class="col col-12">
                <div class="position-relative table-responsive">
                    <table class="table table-bordered w-100 dataTable" id="user_tabl">
                    <input type="hidden" name="export" class="form-control" value="export"> 
                        <thead>
                            <tr>
                                <td>#</td>
                                <td>Name</td>
                                <td>Email</td>
                                <td>Phone Number</td>
                                <td>City</td>
                                <td>State</td>
                                <td>Address</td>
                                <td>Zipcode</td>
                                <td>Date</td>
                                <td>Action</td>
                            </tr>
                        </thead>
                    
                    </table>

                </div>
            </div>
        </div>
    </div>
</div>


<!-- User -->
<div class="modal fade" id="userModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-xl">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">        
                    <h5 id="userHeading" class="modal-title"></h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                
                <div class="modal-body">
                    <form action="{{ route('userlist.store') }}" id="userForm" method="post" enctype="multipart/form-data">
                        <input type="hidden" name="user_id" id="user_id" >
                        @csrf
                        <div class="row">
                           
                            <div class="col col-lg-6 col-md-6 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Title</label>
                                    <input type="text" id="post-title" class="form-control required"  name="title">
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-12">
                            <div class="mb-3">
                                    <label class="form-label">Image</label>
                                    <input type="text" id="post-image" class="form-control"  name="image">
                                </div>
                            </div>
                            <div class="col col-lg-12 col-md-12 col-12">
                                <div class="mb-3">
                                    <label class="form-label">Body</label>
                                    <textarea type="text" id="post-body" class="form-control ckeditor"  name="body" rows="20"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Tags</label>
                                    <textarea type="text" id="post-tags" class="form-control"  name="tags" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Meta Tags</label>
                                    <textarea type="text" id="post-meta-tag" class="form-control"  name="meta_tag" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Meta Description</label>
                                    <textarea type="text" id="post-meta-desc" class="form-control"  name="meta_description" cols="2" rows="2"></textarea>
                                </div>
                            </div>
                            <div class="col col-lg-6 col-md-6 col-6" style="display:none;">
                                <div class="mb-3">
                                    <label class="form-label">Focus Keywords</label>
                                    <textarea type="text" id="post-keywords" class="form-control"  name="keywords" cols="2" rows="2"></textarea>
                                </div>
                            </div>

                        </div>
                        
                        <div class="row">
                            <div class="col col-12">
                                <button type="submit" id="userSubmit" class="btn btn-primary" value="create">Submit</button>
                            </div>
                        </div>  

                    </form>
                </div>
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
                <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-danger"></i>
                <h5 class="mb-4">Are you sure? You want to delete?</h5>
                <div class="position-relative text-center">                    
                    <button  type="button" class="btn btn-danger" onclick="actionmethod()">Yes</a>
                    <button type="button" class="btn btn-secondary ms-2" data-bs-dismiss="modal" aria-label="Close">Cancel</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</div>
@endsection
@section('script')
<script>
var user ='';
var myurl = '{{route('userlist.tableData')}}';
$(function () {
    //$(document).on('change','#editModal select.page',function(){

    $('#createUser').click(function () {
        $('#userSubmit').val("create-user");
        $('user_id').val('');
        $('#userForm').trigger("reset");
        $('#userHeading').html("Create User");
        $('#userModal').modal('show');
    });

    $('body').on('click', '.editUser', function () {
        var user_id = $(this).data('id');
        $.get("{{ route('userlist.index') }}" +'/' + user_id +'/edit', function (data) {
            $('#userHeading').html("Edit User");
            $('#userSubmit').val("edit-user");
            $('#userModal').modal('show');
            $('#user_id').val(data.id);
            $('#user-name').val(data.name);
            $('#user-last_name').val(data.last_name);
        });
    });

    $('body').on('click', '#userFilter button', function () {
        var user_id = $(this).data('id');
        $.get("{{ route('userlist.tableData') }}?from=&to=", function (data) {
            $('#userHeading').html("Edit User");
            $('#userSubmit').val("edit-user");
            $('#userModal').modal('show');
            $('#user_id').val(data.id);
            $('#user-name').val(data.name);
            $('#user-last_name').val(data.last_name);
        });
    });

    $('#userFilters').on('submit', function (event) {
            
            event.preventDefault();
                if($(this).valid()){
        
                    var from = $("#user-form").val();
                    var to = $("#user-to").val();

                    var form = new FormData();
                    form.append('from', from);
                    form.append('to', to);     
        
                    $.ajax({
                        type : 'GET',
                        url : '{{route('userlist.index')}}',
                        headers: {
                            'X-CSRF-TOKEN' : $('input[name="_token"]').val()
                        },
                        data : form,
                        cache: false,
                        contentType: false,
                        processData: false,
                        dataType: 'json',
                        success: function(data){
                            submitButton.prop('disabled', false).text('Submit');
                            post.ajax.reload();
                            $('.modal').modal('hide');
                            $('#postForm')[0].reset();
                        },
                        error: function() {
                           
                        }
                    });
                 
                }
        });


});

user= $('#user_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('userlist.tableData')}}?source=user',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        {
            data: null,
            render: function (data, type, row) {
                return (row.name || '') + ' ' + (row.last_name || '');
            }
        },
        { data: 'email', name: 'email' },
        {
            data: null,
            render: function (data, type, row) {
                return (row.dial_code || '') + ' ' + (row.phone_number || '');
            }
        },
        { data: 'city', name: 'city' },
        { data: 'state', name: 'state' },
        { data: 'address', name: 'address' },
        { data: 'zip_code', name: 'zip_code' },
        {
            data: 'created_at',
            name: 'created_at',
            render: function (data, type, row) {
                if (type === 'display' || type === 'filter') {
                    return data ? moment(data).format('DD-MM-YYYY HH:mm:ss') : '';
                }
                return data;
            }
        },

        
        {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
               
                deleteurl = `{{ route('userlist.delete') }}`+'?user_id='+row.id;

                var deleteButton = `<a class="dropdown-item cursor-pointer" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('`+deleteurl+`')">Delete</a>`;
                return  ` <div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>` + deleteButton + `</li>
                            </ul>
                        </div>`;

            },
        },

        // Add other columns as needed
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
                /* "oLanguage": {
            "sLengthMenu": "Display _MENU_ records per page",
            // other language options
        },*/

        info: 'Showing _START_ to _END_ of _TOTAL_ records',
        infoFiltered: '(filtered from _MAX_ total records)',
        
    },
});


$('#userForm').on('submit', function (event) {
            
    event.preventDefault();
        if($(this).valid()){
        var submitButton = $(this).find('[type="submit"]');
            submitButton.prop('disabled', true).text('Please wait...');

        // Serialize form data
            var formData = $(this).serialize();
        
            url = $(this).attr('action');
            runajax(url, formData, 'post', '', 'json', function(output) {
                    // var output = JSON.parse(res);
                    submitButton.prop('disabled', false).text('Submit');
                    user.ajax.reload();
                    $('.modal').modal('hide');
                    $('#userForm')[0].reset();
            
            })
        }
});

function actionmethod()
{
    actionsurl = $('#seturl').val();

    runajax(actionsurl, '', 'get', '', 'json', function(output) {
            
            console.log(output);
            if (output.success) 
            {
                $('.modal').modal('hide');
                user.ajax.reload();

            }else{
                       
            }
        }); 
}

function seturl(url)
{
    $('#seturl').val(url);

}

</script>
@endsection

