// Sidebar Menu
    if ($(window).width() < 1100) {
        console.log('loaded');
        $("#openNav").toggleClass("d-block");
    }
    else {
        $("#openNav").toggleClass("d-none");
        $("#sideNav").toggleClass("sideNav_open");
        $(".admin_content").toggleClass("sideNav_show");
    }
    $("#openNav").click(function(){
        $("#sideNav").toggleClass("sideNav_open");
        $(".admin_content").toggleClass("sideNav_show");
    });

    // Datatable
    // https://datatables.net/examples/styling/bootstrap5.html
    //new DataTable('.dataTable');

    // Popover
var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'))
var popoverList = popoverTriggerList.map(function (popoverTriggerEl) {
  return new bootstrap.Popover(popoverTriggerEl)
});
