// "Süd məhsulları" kateqoriyası hər yerdə eyni qaydada tanınsın deyə.
function isDairyCategory(category) {
  return (category || '').toLocaleLowerCase('az-AZ').includes('süd məhsul');
}

module.exports = { isDairyCategory };
