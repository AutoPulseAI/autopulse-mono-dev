@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content ">
    <div class="row">
        <div class="page_title">
            <h2>Request Demo</h2>
        </div>
    </div>
    <hr>

    <div class="row">
        
        <div class="col col-12">
            <div class="position-relative table-responsive">
                <table class="table table-bordered w-100 dataTable" id="contact_tabl">
                    <thead>
                        <tr>
                            <td>#</td>
                            <td>Dealership</td>
                            <td>First Name</td>
                            <td>Last Name</td>
                            <td>Email</td>
                            <td>Phone</td>
                            <td>Website</td>
                            <td>Date</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                </table>

            </div>
        </div>
    </div>
</div>

<!-- View Info Modal -->
<div class="modal fade" id="showModal" tabindex="-1" aria-labelledby="viewScriptLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-body">
                <button type="button" class="btn-close float-end" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="position-relative float-start w-100 px-lg-5 py-lg-4 p-3">
                    <h5 class="modal-title text_primary mb-3"><b>See Information about contact</b></h5>

                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Dealer Ship Name:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-dealername"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">First Name:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-name"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">last Name:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-last_name"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Phone:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-phone"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Email:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-email"></div>
                    </div>
                    <hr>
                    <div class="row align-items-center">
                        <div class="col col-lg-3 col-md-5 col-12">
                            <h6 class="mb-md-0 mb-2">Website:</h6>
                        </div>
                        <div class="col col-lg-9 col-md-7 col-12" id="contact-website"></div>
                    </div>
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
                    <i class="fa-regular fa-circle-xmark fa-4x mb-3 text-white"></i>
                    <h5 class="mb-4">Are you sure you want to delete this record?</h5>
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
<script>
var contact ='';
var myurl = '{{route('request.tableData')}}';

$(function () {

    $('body').on('click', '.showContact', function () {
        var contact_id = $(this).data('id');
        $.get("{{ route('reqeust.index') }}" +'/' + contact_id +'/show', function (data) {
            $('#showModal').modal('show');
            $('#contact-dealername').text(data.dealership_name);
            $('#contact-name').text(data.first_name);
            $('#contact-last_name').text(data.last_name);          
            $('#contact-email').text(data.email);
            $('#contact-phone').text(data.phone);
            $('#contact-website').text(data.website);
        });
    });

});

contact= $('#contact_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('request.tableData')}}?source=contact',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'dealership_name', name: 'dealership_name' },
        { data: 'first_name', name: 'first_name' },
        { data: 'last_name', name: 'last_name' },
     
        { data: 'email', name: 'email' },
        { data: 'phone', name: 'phone' },
        { data: 'website', name: 'website' },
        {
            data: 'created_at',
            name: 'created_at',
            render: function (data, type, row) {
                if (type === 'display' || type === 'filter') {
                    return moment(data).format('DD-MM-YYYY HH:mm:ss'); // Adjust the format as needed
                }
                return data;
            },
        },
        
        {
            data: null,
            orderable: false, // Disable sorting on this column
            searchable: false, // Disable searching on this column
            render: function (data, type, row) {
                var deleteurl = `{{ route('request.delete') }}`+'?reqeust_id='+row.id;
                var showButton = `<a class="dropdown-item showContact" data-id="`+row.id+`">Show</a>`;
                var deleteButton = `<a class="dropdown-item" data-bs-toggle="modal" data-bs-target="#deleteModal" onclick="seturl('`+deleteurl+`')">Delete</a>`;
                return `
                        <div class="table_action dropdown">
                            <a class="dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="fa-solid fa-ellipsis-vertical"></i></a>
                            <ul class="dropdown-menu">
                                <li>` + showButton + `</li>
                                <li>` + deleteButton + `</li>                          
                            </ul>
                        </div>
                    `;
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

function actionmethod()
{
    actionsurl = $('#seturl').val();

    runajax(actionsurl, '', 'get', '', 'json', function(output) {
            
            console.log(output);
            if (output.success) 
            {
                $('.modal').modal('hide');
                contact.ajax.reload();

            }else{
                       
            }
    }); 
}

function seturl(url )
{
    $('#seturl').val(url);

}
</script>
@endsection
