@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title">
            <h2>Contact Us</h2>
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
                            <td>Name</td>
                            <td>Email</td>
                            <td>Phone</td>
                            <td>Subject</td>
                            <td>Date</td>
                            <td>Action</td>
                        </tr>
                    </thead>
                </table>

            </div>
        </div>
    </div>
</div>

 <!-- Show -->
 <div class="modal fade" id="showModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="adHeading" class="modal-title">See Information about contact</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">

                        <div class="row align-items-center">
                            <div class="col-sm-3">
                                <h6 class="mb-0">Name</h6>
                            </div>
                            <div class="col-sm-9 text-secondary fs-6" id="contact-name"></div>
                        </div>
                        <hr>
                        <div class="row align-items-center">
                            <div class="col-sm-3">
                                <h6 class="mb-0">Phone</h6>
                            </div>
                            <div class="col-sm-9 text-secondary fs-6" id="contact-phone"></div>
                        </div>
                        <hr>
                        <div class="row align-items-center">
                            <div class="col-sm-3">
                                <h6 class="mb-0">Email</h6>
                            </div>
                            <div class="col-sm-9 text-secondary fs-6" id="contact-email"></div>
                        </div>
                        <hr>
                        <div class="row align-items-center">
                            <div class="col-sm-3">
                                <h6 class="mb-0">Subject</h6>
                            </div>
                            <div class="col-sm-9 text-secondary fs-6" id="contact-subject"></div>
                        </div>
                        <hr>
                        <div class="row align-items-center">
                            <div class="col-sm-3">
                                <h6 class="mb-0">Message</h6>
                            </div>
                            <div class="col-sm-9 text-secondary fs-6" id="contact-message"></div>
                        </div>
                
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
var contact ='';
var myurl = '{{route('contact.tableData')}}';

$(function () {

    $('body').on('click', '.showContact', function () {
        var contact_id = $(this).data('id');
        $.get("{{ route('contact.index') }}" +'/' + contact_id +'/show', function (data) {
            $('#showModal').modal('show');
            $('#contact-name').text(data.name);
            $('#contact-email').text(data.email);
            $('#contact-phone').text(data.phone);
            $('#contact-subject').text(data.subject);
            $('#contact-message').text(data.message);
        });
    });

});

contact= $('#contact_tabl').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url:   '{{route('contact.tableData')}}?source=contact',
        type: 'GET',
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
        { data: 'email', name: 'email' },
        { data: 'phone', name: 'phone' },
        { data: 'subject', name: 'subject' },
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
            
                deleteurl = `{{ route('contact.delete') }}`+'?contact_id='+row.id;

                var showButton = `<button class="btn btn-primary btn-sm showContact" data-id="`+row.id+`">Show</button>`;

                var deleteButton = `<button class="btn btn-outline-secondary btn-sm mx-2" data-bs-toggle="modal" data-bs-target="#deleteModal"
                onclick="seturl('`+deleteurl+`')">
                Delete
                </button>`;
                return showButton +' '+ deleteButton;

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
